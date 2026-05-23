/**
 * Workspace Symbols 命令 - 全局搜索
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { stringToSymbolKind, symbolKindToString } from '../../core/utils/symbolKind';
import { looksLikeJdkSymbol, buildJdkHint } from '../../core/utils/jdkSymbolHint';
import { validateFindCommand } from '../utils/paramValidator';

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls find <query> [options]
       jls f <query> [options]

全局搜索类、方法、字段。

Options:
  --kind <type>   按符号类型过滤：Class | Method | Field | Interface ...
  --limit <n>     最大结果数（默认 50）
  -h, --help      显示帮助

Examples:
  jls find UserService
  jls find ArrayList --kind Class
  jls find process --kind Method --limit 20

On ambiguity:
  用 --kind 缩小搜索范围。
  如果无结果且查询看起来像 JDK 类，工具会自动提示。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerWorkspaceSymbolsCommand(program: Command) {
  program
    .command('find <query>')
    .alias('f')
    .description('全局搜索类、方法、字段。')
    .configureHelp({ formatHelp: () => HELP })
    .option('--kind <type>', '按符号类型过滤：Class, Method, Field, Interface...')
    .option('--limit <n>', '最大结果数', '50')
    .action(async (query: string, cmdOptions: any) => {
      const opts = program.opts();

      // 防呆：校验参数格式
      const validationError = validateFindCommand(cmdOptions);
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }

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

            if (outputSymbols.length === 0 && looksLikeJdkSymbol(query, cmdOptions.kind)) {
              throw new Error(
                `No symbols found for '${query}'.\n` + buildJdkHint(query, cmdOptions.kind)
              );
            }

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
