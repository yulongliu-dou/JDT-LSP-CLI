/**
 * Symbols 命令 - 文档符号
 */

import { Command } from 'commander';
import * as path from 'path';
import { executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { symbolKindToString } from '../../core/utils/symbolKind';
import { validateSymbolsCommand } from '../utils/paramValidator';

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls symbols <file> [options]
       jls sym <file> [options]

列出文件中的所有符号（类、方法、字段等）。

Options:
  --flat       扁平化输出（去掉层次结构）
  -h, --help   显示帮助

Examples:
  jls sym src/main/java/com/example/Service.java
  jls sym src/main/java/com/example/Service.java --flat
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerSymbolsCommand(program: Command) {
  program
    .command('symbols <file>')
    .alias('sym')
    .description('列出文件中的所有符号。')
    .configureHelp({ formatHelp: () => HELP })
    .option('--flat', '扁平化输出')
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();
      const filePath = resolveFilePath(file, opts.project);
      const projectPath = path.resolve(opts.project);

      // 防呆：校验文件存在性
      const validationError = validateSymbolsCommand(filePath, { project: opts.project });
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }
      
      await executeCommand(
        '/symbols',
        {
          project: projectPath,
          file: filePath,
          flat: cmdOptions.flat,
          options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
        },
        async () => {
          let client: JdtLsClient | null = null;
          try {
            client = await createDirectClient(opts);
            let result = await client.getDocumentSymbols(filePath);
            
            if (cmdOptions.flat) {
              const flatList: any[] = [];
              function flatten(symbols: any[], parent?: string) {
                for (const sym of symbols) {
                  flatList.push({ 
                    name: sym.name, 
                    kind: symbolKindToString(sym.kind), 
                    detail: sym.detail, 
                    range: sym.range, 
                    parent 
                  });
                  if (sym.children) flatten(sym.children, sym.name);
                }
              }
              flatten(result);
              result = flatList;
            } else {
              // 层次化输出也需要转换 kind
              function convertKind(symbols: any[]): any[] {
                return symbols.map(sym => ({
                  ...sym,
                  kind: symbolKindToString(sym.kind),
                  children: sym.children ? convertKind(sym.children) : undefined
                }));
              }
              result = convertKind(result);
            }
            
            return { symbols: result, count: cmdOptions.flat ? result.length : undefined };
          } finally {
            if (client) await client.stop();
          }
        },
        opts,
        'symbols'
      );
    });
}

function resolveFilePath(filePath: string, projectPath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectPath, filePath);
}
