/**
 * Rename 命令 - 语义级重命名
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateRenameCommand } from '../utils/paramValidator';

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

    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
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
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const workspaceEdit = await client.getRename(filePath, parseInt(resolvedLine), parseInt(resolvedCol), newName);
          // 扁平化 WorkspaceEdit → { changes: [...], count }
          return flattenWorkspaceEdit(workspaceEdit);
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'rename'
    );
  });
}

function flattenWorkspaceEdit(workspaceEdit: any) {
  const changes: any[] = [];

  if (workspaceEdit?.changes) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes) as [string, any[]][]) {
      for (const edit of edits) {
        changes.push({
          file: uri,
          range: edit.range,
          newText: edit.newText,
        });
      }
    }
  }

  if (workspaceEdit?.documentChanges) {
    for (const docChange of workspaceEdit.documentChanges) {
      if (docChange.textDocument && docChange.edits) {
        for (const edit of docChange.edits) {
          changes.push({
            file: docChange.textDocument.uri,
            range: edit.range,
            newText: edit.newText,
          });
        }
      }
    }
  }

  return { changes, count: changes.length };
}

async function createDirectClient(options: any): Promise<JdtLsClient> {
  const { JdtLsClient } = require('../../jdtClient');
  const client = new JdtLsClient({
    projectPath: path.resolve(options.project),
    jdtlsPath: options.jdtlsPath,
    dataDir: options.dataDir,
    timeout: parseInt(options.timeout, 10),
    verbose: options.verbose,
  });
  await client.start();
  return client;
}
