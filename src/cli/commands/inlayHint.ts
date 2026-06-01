/**
 * Inlay Hint 命令 - 获取编译器推断的类型信息
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';

import { INLAY_HINT_HELP } from './help/inlayHintHelp';

export function registerInlayHintCommand(program: Command) {
  let cmd = program
    .command('inlay-hint [file]')
    .alias('inlay')
    .description('获取推断类型和参数名标注（var 类型、参数名等）。');

  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate' },
    { flags: '--container <path>', desc: 'Parent container path' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: 'Global search (requires --symbol AND --kind)' },
  ];

  for (const opt of symbolOptions) { cmd = cmd.option(opt.flags, opt.desc); }

  cmd.configureHelp({ formatHelp: () => INLAY_HINT_HELP })
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();

      const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'inlay');
      if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }

      const projectPath = path.resolve(opts.project);
      const posResult = await getPosition(file, cmdOptions, opts);
      if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }

      const { filePath: fp, line, col, sharedClient } = posResult;

      await executeCommand('/inlay-hint', {
        project: projectPath, file: fp, line, col,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async (client) => {
        const hints = await client.getInlayHint(fp, parseInt(line), parseInt(col));
        return { hints, count: Array.isArray(hints) ? hints.length : 0 };
      }, opts, 'inlayHint');
    });
}
