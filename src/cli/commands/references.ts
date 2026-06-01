/**
 * References 命令 - 查找引用
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { initDirectModeRewriter, rewriteDirectLocations } from '../utils/directModeRewriter';
import { analyzeFieldLifecycle } from '../../services/fieldLifecycleService';
import { DocumentSymbol } from '../../core/types';

import { REFERENCES_HELP } from './help/referencesHelp';

// ── Command ───────────────────────────────────────────────────────────────────

export function registerReferencesCommand(program: Command) {
  let referencesCmd = program
    .command('references [file]')
    .alias('refs')
    .description('查找符号的所有引用。')
    .configureHelp({ formatHelp: () => REFERENCES_HELP })
    .option('--no-declaration', '排除声明本身')
    .option('--lifecycle', '字段全生命周期追踪模式');
  
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
    referencesCmd = referencesCmd.option(opt.flags, opt.desc);
  }
  
  referencesCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    // 防呆：校验参数合法性
    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'refs');
    if (validationError) {
      outputResult(validationError, undefined, opts.jsonCompact, opts.output);
      return;
    }

    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult, undefined, opts.jsonCompact, opts.output);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol, sharedClient } = posResult;
    const includeDecl = cmdOptions.declaration !== false;
    const lifecycle = cmdOptions.lifecycle === true;

    await executeCommand(
      '/references',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        includeDeclaration: includeDecl,
        lifecycle,
        symbol: cmdOptions.symbol,
        kind: cmdOptions.kind,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async (client) => {
        await initDirectModeRewriter(client, projectPath);
        const result = await client.getReferences(filePath, parseInt(resolvedLine), parseInt(resolvedCol), includeDecl);
        const rewritten = await rewriteDirectLocations(result);

        if (lifecycle && cmdOptions.symbol) {
          const symbols = await client.getDocumentSymbols(filePath);
          const flatSymbols: DocumentSymbol[] = [];
          function flatten(syms: any[]): void {
            for (const sym of syms) {
              flatSymbols.push(sym);
              if (sym.children) flatten(sym.children);
            }
          }
          flatten(symbols);

          const fieldSym = flatSymbols.find((s: any) => {
            const k = s.kind;
            return (k === 'Field' || k === 8) && s.name === cmdOptions.symbol;
          });

          const fieldType = fieldSym?.detail || 'unknown';
          const containingClass = extractClassName(filePath);
          const numericLine = parseInt(resolvedLine);
          const numericCol = parseInt(resolvedCol);

          const lifecycleResult = await analyzeFieldLifecycle(
            cmdOptions.symbol,
            fieldType,
            containingClass,
            filePath,
            numericLine,
            numericCol,
            projectPath,
            client as any,
            includeDecl
          );

          lifecycleResult.references = lifecycleResult.references.map(ref => {
            const matchingRewritten = (rewritten as any[]).find(
              (r: any) => r.uri === ref.uri &&
                   r.range.start.line === ref.range.start.line &&
                   r.range.start.character === ref.range.start.character
            );
            if (matchingRewritten) {
              return {
                ...ref,
                originalUri: matchingRewritten.originalUri,
                originalRange: matchingRewritten.originalRange,
                source: matchingRewritten.source,
                note: matchingRewritten.note,
                lockWaitMs: matchingRewritten.lockWaitMs,
                lineMapping: matchingRewritten.lineMapping,
              };
            }
            return ref;
          });

          return {
            summary: lifecycleResult.summary,
            references: lifecycleResult.references,
            hints: lifecycleResult.hints,
            count: lifecycleResult.references.length,
          };
        }

        return { references: rewritten, count: rewritten.length };
      },
      opts,
      'references'
    );
  });
}

function extractClassName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1] || '';
  return fileName.replace(/\.java$/, '');
}
