/**
 * CLI 命令处理函数
 * 
 * 包含所有 LSP 命令的实现逻辑
 */

import { Command } from 'commander';
import * as path from 'path';
import { JdtLsClient } from '../jdtClient';
import { SymbolQuery, ResolvedPosition, SymbolResolutionError, SymbolInfo } from '../core/types';
import { getPosition, executeCommand } from './utils/positionResolver';
import { outputResult } from './utils/outputHandler';
import { stringToSymbolKind, symbolKindToString } from '../core/utils/symbolKind';

/**
 * Call Hierarchy 命令实现
 */
export async function handleCallHierarchy(
  client: JdtLsClient,
  filePath: string,
  line: number,
  col: number,
  options: { depth: string; incoming: boolean }
): Promise<any> {
  const items = await client.prepareCallHierarchy(filePath, line, col) as any[];
  
  if (!items || items.length === 0) {
    return { entry: null, calls: [], totalMethods: 0 };
  }
  
  const maxDepth = parseInt(options.depth, 10);
  const visited = new Set<string>();
  const allCalls: any[] = [];
  
  async function collectCalls(item: any, depth: number): Promise<void> {
    const key = `${item.uri}#${item.name}#${item.range?.start?.line}`;
    if (visited.has(key) || depth > maxDepth) return;
    visited.add(key);
    
    const calls = options.incoming
      ? await client.getIncomingCalls(item)
      : await client.getOutgoingCalls(item);
    
    for (const call of calls as any[]) {
      const target = options.incoming ? call.from : call.to;
      if (!target.uri.includes('jdt://')) {
        allCalls.push({
          depth,
          caller: options.incoming ? target.name : item.name,
          callee: options.incoming ? item.name : target.name,
          location: { uri: target.uri, range: target.range },
          kind: target.kind,
        });
        await collectCalls(target, depth + 1);
      }
    }
  }
  
  await collectCalls(items[0] as any, 0);
  
  return {
    entry: { name: items[0].name, kind: items[0].kind, detail: items[0].detail, uri: items[0].uri, range: items[0].range },
    calls: allCalls,
    totalMethods: visited.size,
  };
}

/**
 * Definition 命令实现
 */
export async function handleDefinition(
  client: JdtLsClient,
  filePath: string,
  line: number,
  col: number
): Promise<any> {
  return await client.getDefinition(filePath, line, col);
}

/**
 * References 命令实现
 */
export async function handleReferences(
  client: JdtLsClient,
  filePath: string,
  line: number,
  col: number,
  includeDeclaration: boolean
): Promise<any> {
  const result = await client.getReferences(filePath, line, col, includeDeclaration) as any[];
  return { references: result, count: result.length };
}

/**
 * Symbols 命令实现
 */
export async function handleSymbols(
  client: JdtLsClient,
  filePath: string,
  flat: boolean
): Promise<any> {
  let result = await client.getDocumentSymbols(filePath) as any[];
  
  if (flat) {
    const flatList: any[] = [];
    function flatten(symbols: any[], parent?: string) {
      for (const sym of symbols) {
        flatList.push({ name: sym.name, kind: sym.kind, detail: sym.detail, range: sym.range, parent });
        if (sym.children) flatten(sym.children, sym.name);
      }
    }
    flatten(result);
    result = flatList;
  }
  
  return { symbols: result, count: flat ? result.length : undefined };
}

/**
 * Workspace Symbols 命令实现
 */
export async function handleWorkspaceSymbols(
  client: JdtLsClient,
  query: string,
  limit: number,
  kind?: string
): Promise<any> {
  let symbols = await client.getWorkspaceSymbols(query, limit) as any[];
  
  // 按 kind 过滤 - 将字符串转换为数字进行比较
  if (kind) {
    const kindNumber = stringToSymbolKind(kind);
    if (kindNumber === undefined) {
      throw new Error(`Invalid symbol kind: ${kind}. Supported: Class, Method, Field, Interface, Enum, etc.`);
    }
    symbols = symbols.filter((s: any) => s.kind === kindNumber);
  }
  
  // 将 kind 数字转换为字符串用于输出
  const outputSymbols = symbols.map((s: any) => ({
    ...s,
    kind: symbolKindToString(s.kind)
  }));
  
  return { symbols: outputSymbols, count: outputSymbols.length };
}

/**
 * Type Definition 命令实现
 */
export async function handleTypeDefinition(
  client: JdtLsClient,
  filePath: string,
  line: number,
  col: number,
  explainEmpty: boolean
): Promise<any> {
  return await client.getTypeDefinition(filePath, line, col, explainEmpty);
}

/**
 * Implementations 命令实现
 */
export async function handleImplementations(
  client: JdtLsClient,
  filePath: string,
  line: number,
  col: number
): Promise<any> {
  const result = await client.getImplementations(filePath, line, col) as any[];
  return { implementations: result, count: result.length };
}

/**
 * Hover 命令实现
 */
export async function handleHover(
  client: JdtLsClient,
  filePath: string,
  line: number,
  col: number
): Promise<any> {
  return await client.getHover(filePath, line, col);
}

/**
 * Call Hierarchy 命令注册
 */
export function registerCallHierarchyCommand(program: Command) {
  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate (auto-resolve position)' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate (auto-resolve position)' },
    { flags: '--container <path>', desc: 'Parent container path, e.g., "MyClass.myMethod"' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads, e.g., "(String, int)"' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: '⚠️ Global search (requires --symbol AND --kind, JDT LS limitation)' },
  ];
  
  let callHierarchyCmd = program
    .command('call-hierarchy [file] [line] [col]')
    .alias('ch')
    .description('Get call hierarchy for a method. AI-friendly modes: lazy, snapshot, summary.')
    .option('-d, --depth <n>', 'Maximum recursion depth', '3')
    .option('--incoming', 'Get incoming calls instead of outgoing', false)
    // AI友好模式选项
    .option('--mode <type>', 'Query mode: lazy|snapshot|summary (default: legacy)', 'legacy')
    .option('--cursor <id>', 'Cursor ID for lazy mode (continue previous query)')
    .option('--fetch-source <ids>', 'Comma-separated method IDs to fetch source (lazy mode)')
    .option('--expand-depth <ids>', 'Comma-separated method IDs to expand sub-calls (lazy mode)')
    .option('--snapshot-path <path>', 'Output path for snapshot mode')
    .option('--max-summary-depth <n>', 'Max depth for summary mode', '2');
  
  for (const opt of symbolOptions) {
    callHierarchyCmd = callHierarchyCmd.option(opt.flags, opt.desc);
  }
  
  callHierarchyCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult, undefined, opts.jsonCompact, opts.output);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    // 根据mode选择不同的处理逻辑
    if (cmdOptions.mode === 'legacy') {
      // 原有逻辑(保持向后兼容)
      await executeCommand(
        '/call-hierarchy',
        {
          project: projectPath,
          file: filePath,
          line: resolvedLine,
          col: resolvedCol,
          depth: cmdOptions.depth,
          incoming: cmdOptions.incoming,
          options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
        },
        async () => {
          let client: JdtLsClient | null = null;
          try {
            client = await createDirectClient(opts);
            const items = await client.prepareCallHierarchy(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
            
            if (!items || items.length === 0) {
              return { entry: null, calls: [], totalMethods: 0 };
            }
            
            const maxDepth = parseInt(cmdOptions.depth, 10);
            const visited = new Set<string>();
            const allCalls: any[] = [];
            
            async function collectCalls(item: any, depth: number): Promise<void> {
              const key = `${item.uri}#${item.name}#${item.range?.start?.line}`;
              if (visited.has(key) || depth > maxDepth) return;
              visited.add(key);
              
              const calls = cmdOptions.incoming
                ? await client!.getIncomingCalls(item)
                : await client!.getOutgoingCalls(item);
              
              for (const call of calls as any[]) {
                const target = cmdOptions.incoming ? call.from : call.to;
                if (!target.uri.includes('jdt://')) {
                  allCalls.push({
                    depth,
                    caller: cmdOptions.incoming ? target.name : item.name,
                    callee: cmdOptions.incoming ? item.name : target.name,
                    location: { uri: target.uri, range: target.range },
                    kind: target.kind,
                  });
                  await collectCalls(target, depth + 1);
                }
              }
            }
            
            await collectCalls(items[0], 0);
            
            return {
              entry: { name: items[0].name, kind: items[0].kind, detail: items[0].detail, uri: items[0].uri, range: items[0].range },
              calls: allCalls,
              totalMethods: visited.size,
            };
          } finally {
            if (client) await client.stop();
          }
        },
        opts,
        'callHierarchy'
      );
    } else {
      // 新的AI友好模式
      await executeCommand(
        `/call-hierarchy/${cmdOptions.mode}`,
        {
          project: projectPath,
          file: filePath,
          line: resolvedLine,
          col: resolvedCol,
          mode: cmdOptions.mode,
          depth: cmdOptions.depth,
          incoming: cmdOptions.incoming,
          cursor: cmdOptions.cursor,
          fetchSource: cmdOptions.fetchSource,
          expandDepth: cmdOptions.expandDepth,
          snapshotPath: cmdOptions.snapshotPath,
          maxSummaryDepth: cmdOptions.maxSummaryDepth,
          options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
        },
        async () => {
          let client: JdtLsClient | null = null;
          try {
            client = await createDirectClient(opts);
            const { EnhancedCallHierarchyService } = await import('../services/enhancedCallHierarchyService');
            const service = new EnhancedCallHierarchyService((client as any).connectionManager);
            
            const query = {
              filePath,
              line: parseInt(resolvedLine),
              col: parseInt(resolvedCol),
              mode: cmdOptions.mode,
              depth: parseInt(cmdOptions.depth),
              direction: (cmdOptions.incoming ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
              cursor: cmdOptions.cursor,
              fetchSource: cmdOptions.fetchSource ? cmdOptions.fetchSource.split(',') : undefined,
              expandDepth: cmdOptions.expandDepth ? cmdOptions.expandDepth.split(',') : undefined,
              snapshotPath: cmdOptions.snapshotPath,
              maxSummaryDepth: parseInt(cmdOptions.maxSummaryDepth),
            };
            
            return await service.executeQuery(query);
          } finally {
            if (client) await client.stop();
          }
        },
        opts,
        'callHierarchy'
      );
    }
  });
}

async function createDirectClient(options: any): Promise<JdtLsClient> {
  const client = new JdtLsClient({
    projectPath: path.resolve(options.project),
    jdtlsPath: options.jdtlsPath,
    dataDir: options.dataDir,
    timeout: parseInt(options.timeout, 10),
    verbose: options.verbose,
  });

  await client.start();
  return client;
}
