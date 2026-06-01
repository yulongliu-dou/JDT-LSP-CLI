/**
 * Rename 命令 - 语义级重命名
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateRenameCommand } from '../utils/paramValidator';
import { flattenWorkspaceEdit } from '../../core/utils/workspaceEdit';

import { RENAME_HELP } from './help/renameHelp';

export function registerRenameCommand(program: Command) {
  let renameCmd = program
    .command('rename <file>')
    .description('语义级重命名：返回所有需要修改的位置（WorkspaceEdit），不遗漏、不误改字符串。')
    .configureHelp({ formatHelp: () => RENAME_HELP });

  // 添加符号定位选项
  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate (auto-resolve position)' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate (auto-resolve position)' },
    { flags: '--container <path>', desc: 'Parent container path, e.g., "MyClass.myMethod"' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads, e.g., "(String, int)"' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: 'Global search (requires --symbol AND --kind)' },
    { flags: '--new-name <name>', desc: 'New name for the symbol (required)' },
  ];

  for (const opt of symbolOptions) {
    renameCmd = renameCmd.option(opt.flags, opt.desc);
  }

  renameCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    const validationError = validateRenameCommand(file, cmdOptions, opts);
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
    const newName = cmdOptions.newName;

    await executeCommand(
      '/rename',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        newName,
        symbol: cmdOptions.symbol,
        kind: cmdOptions.kind,
        index: cmdOptions.index,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async (client) => {
        const workspaceEdit = await client.getRename(filePath, parseInt(resolvedLine), parseInt(resolvedCol), newName);
        // 扁平化 WorkspaceEdit → { changes: [...], count }
        return flattenWorkspaceEdit(workspaceEdit);
      },
      opts,
      'rename'
    );
  });
}

