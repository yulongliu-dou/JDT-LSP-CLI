/**
 * Completion 命令 - 获取补全候选列表
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { CompletionItemKindMap } from '../../core/types';

import { COMPLETION_HELP } from './help/completionHelp';

export function registerCompletionCommand(program: Command) {
  let cmd = program
    .command('completion [file]')
    .alias('complete')
    .description('获取指定位置的补全候选列表（方法、字段、类名）。');

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

  cmd.configureHelp({ formatHelp: () => COMPLETION_HELP })
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();

      const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'complete');
      if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }

      const projectPath = path.resolve(opts.project);
      const posResult = await getPosition(file, cmdOptions, opts);
      if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }

      const { filePath: fp, line, col } = posResult;

      await executeCommand('/completion', {
        project: projectPath, file: fp, line, col,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const result = await client.getCompletion(fp, parseInt(line), parseInt(col));
          const items = result?.items || result || [];
          const itemsArray = Array.isArray(items) ? items : [];
          const mapped = itemsArray.map((item: any) => ({
            ...item,
            kind: CompletionItemKindMap[item.kind] || item.kind,
          }));
          return {
            items: mapped,
            count: mapped.length,
            isIncomplete: result?.isIncomplete ?? false,
          };
        } finally { if (client) await client.stop(); }
      }, opts, 'completion');
    });
}

async function createDirectClient(options: any): Promise<JdtLsClient> {
  const { JdtLsClient } = require('../../jdtClient');
  const client = new JdtLsClient({
    projectPath: path.resolve(options.project), jdtlsPath: options.jdtlsPath,
    dataDir: options.dataDir, timeout: parseInt(options.timeout, 10), verbose: options.verbose,
  });
  await client.start();
  return client;
}
