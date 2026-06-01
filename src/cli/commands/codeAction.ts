/**
 * Code Action 命令 - 获取可用的快速修复和重构操作列表
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';

import { CODE_ACTION_HELP } from './help/codeActionHelp';

export function registerCodeActionCommand(program: Command) {
  let cmd = program
    .command('code-action [file]')
    .alias('action')
    .description('获取可用的快速修复和重构操作列表（import、提取方法、实现接口等）。');

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

  cmd.configureHelp({ formatHelp: () => CODE_ACTION_HELP })
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();

      const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'action');
      if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }

      const projectPath = path.resolve(opts.project);
      const posResult = await getPosition(file, cmdOptions, opts);
      if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }

      const { filePath: fp, line, col, sharedClient } = posResult;

      await executeCommand('/code-action', {
        project: projectPath, file: fp, line, col,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async (client) => {
        const actions = await client.getCodeAction(fp, parseInt(line), parseInt(col));
        return { actions, count: Array.isArray(actions) ? actions.length : 0 };
      }, opts, 'codeAction');
    });
}
