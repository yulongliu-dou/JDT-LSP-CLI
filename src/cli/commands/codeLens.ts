/**
 * Code Lens 命令 - 获取方法上的 code lens 信息
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateCodeLensCommand } from '../utils/paramValidator';

import { CODE_LENS_HELP } from './help/codeLensHelp';

export function registerCodeLensCommand(program: Command) {
  program
    .command('code-lens <file>')
    .alias('lens')
    .description('获取方法上的 code lens 信息（引用数量、Override 标注等）。')
    .configureHelp({ formatHelp: () => CODE_LENS_HELP })
    .action(async (file: string) => {
      const opts = program.opts();

      const validationError = validateCodeLensCommand(file, opts);
      if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }

      const projectPath = path.resolve(opts.project);
      const filePath = path.isAbsolute(file) ? file : path.resolve(projectPath, file);

      await executeCommand('/code-lens', {
        project: projectPath, file: filePath,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const lenses = await client.getCodeLens(filePath);
          const parsed = Array.isArray(lenses)
            ? lenses.map((lens: any) => {
                const data = lens.data;
                const parsedData = Array.isArray(data) && data.length >= 3
                  ? { fileUri: data[0], position: data[1], type: data[2] }
                  : data;
                return {
                  range: lens.range,
                  type: parsedData?.type || null,
                  command: lens.command || null,
                };
              })
            : lenses;
          return { lenses: parsed, count: Array.isArray(parsed) ? parsed.length : 0 };
        } finally { if (client) await client.stop(); }
      }, opts, 'codeLens');
    });
}
