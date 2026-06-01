/**
 * Diagnostics 命令 - 获取文件编译诊断信息
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateDiagnosticsCommand } from '../utils/paramValidator';

import { DIAGNOSTICS_HELP } from './help/diagnosticsHelp';

export function registerDiagnosticsCommand(program: Command) {
  program
    .command('diagnostics <file>')
    .alias('diag')
    .description('获取文件的编译错误和警告列表。')
    .configureHelp({ formatHelp: () => DIAGNOSTICS_HELP })
    .action(async (file: string) => {
      const opts = program.opts();

      const validationError = validateDiagnosticsCommand(file, opts);
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }

      const projectPath = path.resolve(opts.project);
      const filePath = path.isAbsolute(file) ? file : path.resolve(projectPath, file);

      await executeCommand(
        '/diagnostics',
        {
          project: projectPath,
          file: filePath,
          options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
        },
        async (client) => {
          const diagnostics = await client.getDiagnostics(filePath);
          const arr = Array.isArray(diagnostics) ? diagnostics : [];
          return { diagnostics: arr, count: arr.length };
        },
        opts,
        'diagnostics'
      );
    });
}
