/**
 * Workspace Symbols 命令 - 全局搜索
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { stringToSymbolKind, symbolKindToString } from '../../core/utils/symbolKind';

export function registerWorkspaceSymbolsCommand(program: Command) {
  program
    .command('find <query>')
    .alias('f')
    .description('Search symbols across the entire workspace')
    .option('--kind <type>', 'Filter by symbol kind: Class, Method, Field, Interface...')
    .option('--limit <n>', 'Maximum number of results', '50')
    .action(async (query: string, cmdOptions: any) => {
      const opts = program.opts();
      const projectPath = path.resolve(opts.project);
      
      await executeCommand(
        '/workspace-symbols',
        {
          project: projectPath,
          query,
          kind: cmdOptions.kind,
          limit: cmdOptions.limit,
          options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
        },
        async () => {
          let client: JdtLsClient | null = null;
          try {
            client = await createDirectClient(opts);
            let symbols = await client.getWorkspaceSymbols(query, parseInt(cmdOptions.limit));
            
            // 按 kind 过滤 - 将字符串转换为数字进行比较
            if (cmdOptions.kind) {
              const kindNumber = stringToSymbolKind(cmdOptions.kind);
              if (kindNumber === undefined) {
                throw new Error(`Invalid symbol kind: ${cmdOptions.kind}. Supported: Class, Method, Field, Interface, Enum, etc.`);
              }
              symbols = symbols.filter((s: any) => s.kind === kindNumber);
            }
            
            // 将 kind 数字转换为字符串用于输出
            const outputSymbols = symbols.map((s: any) => ({
              ...s,
              kind: symbolKindToString(s.kind)
            }));
            
            return { symbols: outputSymbols, count: outputSymbols.length };
          } finally {
            if (client) await client.stop();
          }
        },
        opts,
        'workspaceSymbols'
      );
    });
}
