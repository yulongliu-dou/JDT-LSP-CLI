/**
 * Declaration 命令 - 跳转到符号声明
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { initDirectModeRewriter, rewriteDirectLocations } from '../utils/directModeRewriter';

import { DECLARATION_HELP } from './help/declarationHelp';

export function registerDeclarationCommand(program: Command) {
  let cmd = program
    .command('declaration [file]')
    .alias('decl')
    .description('跳转到符号的声明位置（接口声明）。')
    .configureHelp({ formatHelp: () => DECLARATION_HELP });

  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate (auto-resolve position)' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate (auto-resolve position)' },
    { flags: '--container <path>', desc: 'Parent container path, e.g., "MyClass.myMethod"' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads, e.g., "(String, int)"' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: 'Global search (requires --symbol AND --kind, JDT LS limitation)' },
  ];

  for (const opt of symbolOptions) { cmd = cmd.option(opt.flags, opt.desc); }

  cmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'decl');
    if (validationError) {
      outputResult(validationError, undefined, opts.jsonCompact, opts.output);
      return;
    }

    const projectPath = path.resolve(opts.project);

    const posResult = await getPosition(file, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult, undefined, opts.jsonCompact, opts.output);
      return;
    }

    const { filePath, line: resolvedLine, col: resolvedCol, sharedClient } = posResult;

    await executeCommand(
      '/declaration',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async (client) => {
        await initDirectModeRewriter(client, projectPath);
        const result = await client.getDeclaration(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
        const locations = Array.isArray(result) ? result : [];
        const rewritten = await rewriteDirectLocations(locations);
        return { locations: rewritten, count: rewritten.length };
      },
      opts,
      'declaration'
    );
  });
}
