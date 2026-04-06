/**
 * Symbols 命令 - 文档符号
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { symbolKindToString } from '../../core/utils/symbolKind';

export function registerSymbolsCommand(program: Command) {
  program
    .command('symbols <file>')
    .alias('sym')
    .description('Get document symbols')
    .option('--flat', 'Flatten the symbol hierarchy')
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();
      const filePath = resolveFilePath(file, opts.project);
      const projectPath = path.resolve(opts.project);
      
      if (!fs.existsSync(filePath)) {
        outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 }, undefined, opts.jsonCompact, opts.output);
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
