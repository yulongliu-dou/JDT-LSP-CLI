/**
 * PrepareRename 命令 - 检查位置是否可重命名
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';

import { PREPARE_RENAME_HELP } from './help/prepareRenameHelp';

export function registerPrepareRenameCommand(program: Command) {
  let cmd = program
    .command('prepare-rename [file]')
    .alias('preren')
    .description('检查指定位置是否可以重命名，返回可重命名的符号范围。')
    .configureHelp({ formatHelp: () => PREPARE_RENAME_HELP });

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

    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'preren');
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

    await executeCommand(
      '/prepare-rename',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const range = await client.getPrepareRename(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
          if (range && range.start && range.end) {
            return { range, valid: true };
          }
          return { valid: false, reason: 'Cannot rename at this position' };
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'prepareRename'
    );
  });
}
