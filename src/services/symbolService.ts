/**
 * 符号解析服务
 * 
 * 功能：
 * - 基于符号名称定位（无重载场景）
 * - 基于签名区分重载方法（支持模糊匹配）
 * - 基于容器路径定位嵌套符号（匿名类/Lambda）
 * - 基于索引定位多个同名符号
 * - 泛型类型模糊匹配
 * - 智能位置选择（针对不同命令优化）
 */

import { SymbolQuery, ResolvedPosition, SymbolResolutionError, SymbolInfo } from '../core/types';

/**
 * 符号解析结果（成功或失败）
 */
export type SymbolResolveResult = 
  | { success: true; position: ResolvedPosition }
  | { success: false; error: SymbolResolutionError };

/**
 * 命令类型（用于智能位置选择）
 */
export type CommandType = 'hover' | 'definition' | 'references' | 'implementations' | 'call-hierarchy';

/**
 * 从符号的 detail 字段提取参数签名
 * JDT LS 返回的 detail 格式："methodName(String orderId, int quantity) : void"
 */
export function extractSignature(detail: string | undefined): string {
  if (!detail) return '';
  const match = detail.match(/\(([^)]*)\)/);
  return match ? match[1] : '';
}

/**
 * 提取简化的签名（用于用户友好的显示）
 * 例："String orderId, int quantity" -> "(String, int)"
 */
export function extractSimpleSignature(detail: string | undefined): string {
  const sig = extractSignature(detail);
  if (!sig) return '()';
  
  const types = sig
    .split(',')
    .map(param => {
      const trimmed = param.trim();
      const parts = trimmed.split(/\s+/);
      return normalizeGenericType(parts[0] || '');
    })
    .filter(Boolean);
  
  return `(${types.join(', ')})`;
}

/**
 * 规范化泛型类型（移除泛型参数）
 * 例："List<String>" -> "List", "Map<String, Integer>" -> "Map"
 */
export function normalizeGenericType(typeName: string): string {
  if (!typeName) return '';
  // 移除泛型参数：List<String> -> List
  // 处理嵌套泛型：List<Map<String, Integer>> -> List
  // 使用循环处理嵌套泛型
  let result = typeName;
  let prevResult;
  do {
    prevResult = result;
    result = result.replace(/<[^<>]*>/g, '');
  } while (result !== prevResult);
  return result.replace(/<.*$/g, '').trim();
}

/**
 * 规范化单个类型（用于签名规范化）
 */
function normalizeSingleType(typeName: string, stripGenerics: boolean): string {
  let type = typeName.trim();
  if (stripGenerics) {
    // 移除泛型参数
    let result = type;
    let prevResult;
    do {
      prevResult = result;
      result = result.replace(/<[^<>]*>/g, '');
    } while (result !== prevResult);
    type = result.replace(/<.*$/g, '').trim();
  }
  return type.toLowerCase();
}

/**
 * 智能分割签名参数（忽略泛型内的逗号）
 * 例："List<String>, Map<String, Integer>" -> ["List<String>", "Map<String, Integer>"]
 */
function smartSplitSignature(signature: string): string[] {
  const params: string[] = [];
  let current = '';
  let depth = 0;
  
  for (const char of signature) {
    if (char === '<') {
      depth++;
      current += char;
    } else if (char === '>') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      params.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    params.push(current.trim());
  }
  
  return params;
}

/**
 * 规范化签名字符串（移除空格、参数名，只保留类型）
 * 例："String orderId, int quantity" -> "string,int"
 * 支持泛型模糊匹配："List<String>" -> "list"
 */
export function normalizeSignature(signature: string, stripGenerics: boolean = true): string {
  if (!signature) return '';
  
  // 使用智能分割处理泛型内的逗号
  const params = smartSplitSignature(signature);
  
  return params
    .map(param => {
      // 提取类型名（处理泛型和数组）
      const parts = param.split(/\s+/);
      const typeName = parts[0] || '';
      // 使用专门的函数规范化单个类型
      return normalizeSingleType(typeName, stripGenerics);
    })
    .filter(Boolean)
    .join(',');
}

/**
 * 检查符号签名是否匹配查询（支持模糊匹配）
 * 
 * 支持两种查询格式:
 * - 带括号："(String, int)" - 用户友好的格式
 * - 不带括号："String, int" - 内部处理格式
 */
export function matchSignature(symbolDetail: string | undefined, querySignature: string, symbolName?: string): boolean {
  // 从 symbolDetail 提取签名
  let symbolSigFromDetail = extractSignature(symbolDetail);
  
  // 如果 detail 中没有签名，尝试从 name 中提取
  if (!symbolSigFromDetail && symbolName) {
    symbolSigFromDetail = extractSignature(symbolName);
  }
  
  // 如果还是没有签名，说明 symbolDetail 本身就是签名（没有方法名）
  if (!symbolSigFromDetail && symbolDetail) {
    symbolSigFromDetail = symbolDetail;
  }
  
  // 从 querySignature 提取签名（处理带括号和不带括号的情况）
  let querySigClean = querySignature;
  if (querySignature.startsWith('(') && querySignature.endsWith(')')) {
    querySigClean = querySignature.slice(1, -1);
  }
  
  // 精确签名匹配（保留泛型）
  const symbolSigFull = normalizeSignature(symbolSigFromDetail, false);
  const querySigFull = normalizeSignature(querySigClean, false);
  if (symbolSigFull === querySigFull) return true;
  
  // 模糊签名匹配（移除泛型）
  const symbolSig = normalizeSignature(symbolSigFromDetail, true);
  const querySig = normalizeSignature(querySigClean, true);
  if (symbolSig === querySig) return true;
  
  // 部分匹配（仅当至少有一个参数时，且查询是符号的前缀）
  if (symbolSig && querySig && symbolSig.startsWith(querySig)) return true;
  
  return false;
}

/**
 * 模糊匹配符号名称（支持泛型类名）
 */
export function fuzzyMatchName(symbolName: string, queryName: string): boolean {
  if (!symbolName && !queryName) return true;
  if (!symbolName || !queryName) return false;
  
  // 精确匹配
  if (symbolName === queryName) return true;
  
  // 大小写不敏感匹配
  if (symbolName.toLowerCase() === queryName.toLowerCase()) return true;
  
  // 泛型模糊匹配：移除泛型后比较
  const normalizedSymbol = normalizeGenericType(symbolName);
  const normalizedQuery = normalizeGenericType(queryName);
  if (normalizedSymbol === normalizedQuery) return true;
  
  // 大小写不敏感的泛型匹配
  if (normalizedSymbol.toLowerCase() === normalizedQuery.toLowerCase()) return true;
  
  // 前缀匹配（用于部分输入）
  if (normalizedSymbol.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedSymbol)) {
    return true;
  }
  
  // 大小写不敏感的前缀匹配
  const symbolLower = normalizedSymbol.toLowerCase();
  const queryLower = normalizedQuery.toLowerCase();
  if (symbolLower.startsWith(queryLower) || queryLower.startsWith(symbolLower)) {
    return true;
  }
  
  // 子串匹配（支持部分匹配）
  if (symbolLower.includes(queryLower) || queryLower.includes(symbolLower)) {
    return true;
  }
  
  // 下划线转驼峰匹配
  const queryCamelToUnderscore = queryName.replace(/([A-Z])/g, '_$1').toLowerCase();
  const symbolCamelToUnderscore = symbolName.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (queryCamelToUnderscore === symbolCamelToUnderscore) return true;
  if (queryCamelToUnderscore.includes(symbolCamelToUnderscore) || symbolCamelToUnderscore.includes(queryCamelToUnderscore)) {
    return true;
  }
  
  return false;
}

/**
 * 获取最优位置（根据命令类型智能选择）
 */
export function getOptimalPosition(
  symbol: SymbolInfo, 
  command: CommandType = 'definition'
): { line: number; character: number } {
  const selectionRange = symbol.selectionRange || symbol.range;
  
  if (command === 'hover') {
    // hover 命令使用中间位置，提高 JDT LS 返回完整信息的命中率
    const startChar = selectionRange.start.character;
    const endChar = selectionRange.end.character;
    if (selectionRange.start.line === selectionRange.end.line) {
      const midChar = Math.floor((startChar + endChar) / 2);
      return {
        line: selectionRange.start.line + 1,
        character: midChar + 1,
      };
    }
  }
  
  // 其他命令使用起始位置
  return {
    line: selectionRange.start.line + 1,
    character: selectionRange.start.character + 1,
  };
}

/**
 * 构建符号的完整路径
 */
function buildSymbolPath(symbol: SymbolInfo, parentPath: string = ''): string {
  const path = parentPath ? `${parentPath}.${symbol.name}` : symbol.name;
  return path;
}

/**
 * 收集符号树中所有符号的扁平列表（带路径信息）
 */
function collectAllSymbols(
  symbols: SymbolInfo[],
  parentPath: string = ''
): Array<{ symbol: SymbolInfo; path: string }> {
  const result: Array<{ symbol: SymbolInfo; path: string }> = [];
  
  for (const symbol of symbols) {
    const path = buildSymbolPath(symbol, parentPath);
    result.push({ symbol, path });
    
    if (symbol.children && symbol.children.length > 0) {
      result.push(...collectAllSymbols(symbol.children, path));
    }
  }
  
  return result;
}

/**
 * 查找容器符号（用于处理嵌套符号）
 */
function findContainer(
  symbols: SymbolInfo[],
  containerPath: string
): SymbolInfo[] | null {
  const parts = containerPath.split('.');
  let current: SymbolInfo[] = symbols;
  
  for (const part of parts) {
    const found = current.find(s => 
      s.name === part || s.name.includes(part)
    );
    
    if (!found) return null;
    
    if (found.children && found.children.length > 0) {
      current = found.children;
    } else {
      return [];
    }
  }
  
  return current;
}

/**
 * 在符号列表中查找匹配的符号（支持模糊匹配）
 */
function findMatchingSymbols(
  symbols: SymbolInfo[],
  query: SymbolQuery
): Array<{ symbol: SymbolInfo; path: string }> {
  let searchScope: SymbolInfo[];
  let basePath = '';
  
  if (query.container) {
    const containerSymbols = findContainer(symbols, query.container);
    if (!containerSymbols) {
      return [];
    }
    searchScope = containerSymbols;
    basePath = query.container;
  } else {
    searchScope = symbols;
  }
  
  const allSymbols = collectAllSymbols(searchScope, basePath);
  
  return allSymbols.filter(({ symbol }) => {
    if (!fuzzyMatchName(symbol.name, query.name)) return false;
    if (query.kind && symbol.kind !== query.kind) return false;
    if (query.signature && !matchSignature(symbol.detail, query.signature, symbol.name)) {
      return false;
    }
    return true;
  });
}

/**
 * 从符号的 detail 字段提取返回类型
 */
function extractReturnType(detail: string | undefined): string {
  if (!detail) return '';
  const match = detail.match(/:\s*(.+)$/);
  return match ? match[1].trim() : '';
}

/**
 * 生成符号描述（用于错误提示）
 */
function formatSymbolDescription(symbol: SymbolInfo, path: string): string {
  const kindStr = symbol.kind ? ` [${symbol.kind}]` : '';
  
  if (symbol.kind === 'Method' || symbol.kind === 'Constructor') {
    const signature = extractSimpleSignature(symbol.detail);
    const returnType = extractReturnType(symbol.detail);
    const returnStr = returnType ? ` : ${returnType}` : '';
    return `${path}${kindStr} - ${path.split('.').pop()}${signature}${returnStr}`;
  }
  
  return `${path}${kindStr}`;
}

/**
 * 从方法名中提取签名部分
 */
function extractSignatureFromName(name: string): string {
  const match = name.match(/\((.*)\)$/);
  return match ? `(${match[1]})` : '()';
}

/**
 * 生成用于 overloadOptions 的符号描述（包含索引）
 */
function formatOverloadOption(symbol: SymbolInfo, path: string, index: number): string {
  const kindStr = symbol.kind ? ` [${symbol.kind}]` : '';
  const fullName = path.split('.').pop() || symbol.name;
  
  if (symbol.kind === 'Method' || symbol.kind === 'Constructor') {
    const returnType = extractReturnType(symbol.detail);
    const returnStr = returnType ? ` : ${returnType}` : '';
    const simpleName = fullName.split('(')[0];
    const signature = extractSignatureFromName(symbol.name);
    return `[${index}] ${simpleName}${kindStr} - ${signature}${returnStr}`;
  }
  
  return `[${index}] ${fullName}${kindStr}`;
}

/**
 * 查找相似名称的符号（用于错误提示）
 */
function findSimilarNames(
  symbols: SymbolInfo[],
  targetName: string,
  maxResults: number = 5
): string[] {
  const allSymbols = collectAllSymbols(symbols);
  const targetLower = targetName.toLowerCase();
  
  return allSymbols
    .filter(({ symbol }) => {
      const nameLower = symbol.name.toLowerCase();
      if (nameLower.startsWith(targetLower) || targetLower.startsWith(nameLower)) {
        return true;
      }
      if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
        return true;
      }
      return false;
    })
    .slice(0, maxResults)
    .map(({ symbol, path }) => formatSymbolDescription(symbol, path));
}

/**
 * 符号解析服务类
 */
export class SymbolService {
  /**
   * 解析符号位置
   */
  resolveSymbol(
    symbols: SymbolInfo[],
    query: SymbolQuery,
    command: CommandType = 'definition'
  ): SymbolResolveResult {
    // 验证查询参数
    if (!query.name || query.name.trim() === '') {
      return {
        success: false,
        error: {
          type: 'invalid_query',
          message: 'Symbol name is required',
        },
      };
    }
    
    // 查找匹配的符号
    const matches = this.findMatchingSymbols(symbols, query);
    
    // 无匹配
    if (matches.length === 0) {
      const similarNames = findSimilarNames(symbols, query.name);
      const allSymbols = collectAllSymbols(symbols);
      
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `Symbol '${query.name}' not found${query.container ? ` in container '${query.container}'` : ''}`,
          suggestions: {
            similarNames: similarNames.length > 0 ? similarNames : undefined,
            availableSymbols: allSymbols.slice(0, 20).map(({ symbol, path }) => 
              formatSymbolDescription(symbol, path)
            ),
          },
        },
      };
    }
    
    // 唯一匹配
    if (matches.length === 1) {
      const match = matches[0];
      const pos = getOptimalPosition(match.symbol, command);
      return {
        success: true,
        position: {
          line: pos.line,
          character: pos.character,
          confidence: 'exact',
          matchedSymbol: match.path,
        },
      };
    }
    
    // 多个匹配
    if (query.index !== undefined) {
      if (query.index < 0 || query.index >= matches.length) {
        return {
          success: false,
          error: {
            type: 'invalid_query',
            message: `Index ${query.index} out of range. Found ${matches.length} matches (0-${matches.length - 1}).`,
            suggestions: {
              overloadOptions: matches.map(({ symbol, path }, idx) => 
                formatOverloadOption(symbol, path, idx)
              ),
            },
          },
        };
      }
      
      const selected = matches[query.index];
      const pos = getOptimalPosition(selected.symbol, command);
      return {
        success: true,
        position: {
          line: pos.line,
          character: pos.character,
          confidence: 'exact',
          matchedSymbol: selected.path,
        },
      };
    }
    
    // 未指定索引且有多个匹配，返回歧义错误
    return {
      success: false,
      error: {
        type: 'ambiguous',
        message: `Found ${matches.length} symbols named '${query.name}'. Use --signature or --index to disambiguate.`,
        suggestions: {
          overloadOptions: matches.map(({ symbol, path }, idx) => 
            formatOverloadOption(symbol, path, idx)
          ),
        },
      },
    };
  }

  /**
   * 查找匹配的符号
   */
  private findMatchingSymbols(
    symbols: SymbolInfo[],
    query: SymbolQuery
  ): Array<{ symbol: SymbolInfo; path: string }> {
    let searchScope: SymbolInfo[];
    let basePath = '';
    
    if (query.container) {
      const containerSymbols = findContainer(symbols, query.container);
      if (!containerSymbols) {
        return [];
      }
      searchScope = containerSymbols;
      basePath = query.container;
    } else {
      searchScope = symbols;
    }
    
    const allSymbols = collectAllSymbols(searchScope, basePath);
    
    return allSymbols.filter(({ symbol }) => {
      if (!fuzzyMatchName(symbol.name, query.name)) return false;
      if (query.kind && symbol.kind !== query.kind) return false;
      if (query.signature && !matchSignature(symbol.detail, query.signature, symbol.name)) {
        return false;
      }
      return true;
    });
  }

  /**
   * 从命令行选项构建 SymbolQuery
   */
  buildSymbolQuery(options: {
    method?: string;
    symbol?: string;
    container?: string;
    signature?: string;
    index?: string | number;
    kind?: string;
  }): SymbolQuery | null {
    const name = options.method || options.symbol;
    if (!name) return null;
    
    return {
      name,
      kind: options.kind,
      container: options.container,
      signature: options.signature,
      index: options.index !== undefined ? parseInt(String(options.index), 10) : undefined,
    };
  }

  /**
   * 检查是否使用符号定位模式
   */
  isSymbolMode(options: {
    method?: string;
    symbol?: string;
  }): boolean {
    return !!(options.method || options.symbol);
  }
}
