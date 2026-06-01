/**
 * Formatting 命令 - 文件格式化
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFormattingCommand } from '../utils/paramValidator';

import { FORMATTING_HELP } from './help/formattingHelp';

export function registerFormattingCommand(program: Command) {
  program
    .command('formatting <file>')
    .alias('fmt')
    .description('获取文件的格式化编辑列表（TextEdit 数组）。')
    .configureHelp({ formatHelp: () => FORMATTING_HELP })
    .action(async (file: string) => {
      const opts = program.opts();

      const validationError = validateFormattingCommand(file, opts);
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }

      const projectPath = path.resolve(opts.project);
      const filePath = path.isAbsolute(file) ? file : path.resolve(projectPath, file);

      await executeCommand(
        '/formatting',
        {
          project: projectPath,
          file: filePath,
          options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
        },
        async (client) => {
          const edits = await client.getFormatting(filePath);
          const editsArray = Array.isArray(edits) ? edits : [];
          return { edits: editsArray, count: editsArray.length };
        },
        opts,
        'formatting'
      );
    });
}
