/**
 * Workspace Symbols 命令 - 全局搜索
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';

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
            
            // 按 kind 过滤
            if (cmdOptions.kind) {
              const kindFilter = cmdOptions.kind.toLowerCase();
              symbols = symbols.filter((s: any) => 
                s.kind.toLowerCase() === kindFilter
              );
            }
            
            return { symbols, count: symbols.length };
          } finally {
            if (client) await client.stop();
          }
        },
        opts,
        'workspaceSymbols'
      );
    });
}
