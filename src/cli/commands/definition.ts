/**
 * Definition 命令 - 跳转到定义
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { resolveSymbol, buildSymbolQuery } from '../../symbolResolver';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { initDirectModeRewriter, rewriteDirectLocations, rewriteDirectLocation } from '../utils/directModeRewriter';
import { extractAnnotations } from '../../services/fieldLifecycleService';

import { DEFINITION_HELP } from './help/definitionHelp';

export function registerDefinitionCommand(program: Command) {
  let definitionCmd = program
    .command('definition [file]')
    .alias('def')
    .description('跳转到符号的定义位置。')
    .configureHelp({ formatHelp: () => DEFINITION_HELP });

  // 添加符号定位选项
  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate (auto-resolve position)' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate (auto-resolve position)' },
    { flags: '--container <path>', desc: 'Parent container path, e.g., "MyClass.myMethod"' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads, e.g., "(String, int)"' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: '⚠️ Global search (requires --symbol AND --kind, JDT LS limitation)' },
  ];

  for (const opt of symbolOptions) {
    definitionCmd = definitionCmd.option(opt.flags, opt.desc);
  }

  definitionCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'def');
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
      '/definition',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        symbol: cmdOptions.symbol,
        kind: cmdOptions.kind,
        index: cmdOptions.index,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          await initDirectModeRewriter(client, projectPath);
          let finalLine = parseInt(resolvedLine);
          let finalCol = parseInt(resolvedCol);
          // 对 global 模式下解析到的外部文件，用文档符号重新精确定位
          if (cmdOptions.global && cmdOptions.symbol && cmdOptions.kind) {
            try {
              const symbols = await client.getDocumentSymbols(filePath);
              const symbolQuery = buildSymbolQuery({
                symbol: cmdOptions.symbol,
                kind: cmdOptions.kind,
                index: cmdOptions.index,
              });
              if (symbolQuery) {
                const result = resolveSymbol(symbols, symbolQuery, 'definition');
                if (result.success) {
                  finalLine = result.position.line;
                  finalCol = result.position.character;
                }
              }
            } catch {
              console.warn('WARNING: Symbol re-resolution failed in target file, using workspace/symbol position. Result may be imprecise.');
            }
          }
          const defs = await client.getDefinition(filePath, finalLine, finalCol);
          let result: any = defs;
          if (defs) {
            if (defs.uri && defs.range) {
              result = await rewriteDirectLocation(defs);
            } else if (Array.isArray(defs)) {
              result = await rewriteDirectLocations(defs);
            }
          }

          // Field kind: attach annotation info
          if (cmdOptions.kind === 'Field' && cmdOptions.symbol && result) {
            try {
              const content = await import('fs').then(m => m.readFileSync(filePath, 'utf-8'));
              const lines = content.split('\n');
              const className = filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.java$/, '') || '';
              const annotations = extractAnnotations(lines, finalLine - 1, cmdOptions.symbol, className);

              return {
                definition: Array.isArray(result) ? result : [result],
                annotations,
              };
            } catch { /* annotation extraction failure is non-blocking */ }
          }

          return result;
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'definition'
    );
  });
}

