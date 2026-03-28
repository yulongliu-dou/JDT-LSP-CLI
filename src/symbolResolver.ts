/**
 * 符号解析器 - 将符号标识符转换为精确位置
 * 
 * 支持:
 * - 基于符号名称定位（无重载场景）
 * - 基于签名区分重载方法
 * - 基于容器路径定位嵌套符号（匿名类/Lambda）
 * - 基于索引定位多个同名符号
 */

import { SymbolQuery, ResolvedPosition, SymbolResolutionError, SymbolInfo } from './types';

/**
 * 符号解析结果（成功或失败）
 */
export type SymbolResolveResult = 
  | { success: true; position: ResolvedPosition }
  | { success: false; error: SymbolResolutionError };

/**
 * 从符号的 detail 字段提取参数签名
 * JDT LS 返回的 detail 格式: "methodName(String orderId, int quantity) : void"
 */
export function extractSignature(detail: string | undefined): string {
  if (!detail) return '';
  const match = detail.match(/\(([^)]*)\)/);
  return match ? match[1] : '';
}

/**
 * 规范化签名字符串（移除空格、参数名，只保留类型）
 * 例: "String orderId, int quantity" -> "String,int"
 */
export function normalizeSignature(signature: string): string {
  if (!signature) return '';
  
  return signature
    .split(',')
    .map(param => {
      const trimmed = param.trim();
      // 提取类型名（处理泛型和数组）
      const parts = trimmed.split(/\s+/);
      // 返回第一个部分（类型），忽略参数名
      return parts[0] || '';
    })
    .filter(Boolean)
    .join(',')
    .toLowerCase();
}

/**
 * 检查符号签名是否匹配查询
 */
export function matchSignature(symbolDetail: string | undefined, querySignature: string): boolean {
  const symbolSig = normalizeSignature(extractSignature(symbolDetail));
  const querySig = normalizeSignature(querySignature);
  
  // 精确匹配
  if (symbolSig === querySig) return true;
  
  // 部分匹配（查询签名是符号签名的子串）
  if (symbolSig.includes(querySig) || querySig.includes(symbolSig)) return true;
  
  return false;
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
      // 到达叶子节点，返回空数组表示没有子符号
      return [];
    }
  }
  
  return current;
}

/**
 * 在符号列表中查找匹配的符号
 */
function findMatchingSymbols(
  symbols: SymbolInfo[],
  query: SymbolQuery
): Array<{ symbol: SymbolInfo; path: string }> {
  // 如果指定了容器，先定位到容器
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
  
  // 收集所有符号
  const allSymbols = collectAllSymbols(searchScope, basePath);
  
  // 过滤匹配的符号
  return allSymbols.filter(({ symbol }) => {
    // 名称匹配
    if (symbol.name !== query.name) return false;
    
    // 类型匹配（如果指定）
    if (query.kind && symbol.kind !== query.kind) return false;
    
    // 签名匹配（如果指定）
    if (query.signature && !matchSignature(symbol.detail, query.signature)) {
      return false;
    }
    
    return true;
  });
}

/**
 * 生成符号描述（用于错误提示）
 */
function formatSymbolDescription(symbol: SymbolInfo, path: string): string {
  const detail = symbol.detail ? ` - ${symbol.detail}` : '';
  return `${path} [${symbol.kind}]${detail}`;
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
      // 前缀匹配
      if (nameLower.startsWith(targetLower) || targetLower.startsWith(nameLower)) {
        return true;
      }
      // 包含匹配
      if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
        return true;
      }
      return false;
    })
    .slice(0, maxResults)
    .map(({ symbol, path }) => formatSymbolDescription(symbol, path));
}

/**
 * 解析符号位置
 * 
 * @param symbols - documentSymbol 返回的符号树
 * @param query - 符号查询参数
 * @returns 解析结果（成功返回位置，失败返回错误信息）
 */
export function resolveSymbol(
  symbols: SymbolInfo[],
  query: SymbolQuery
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
  const matches = findMatchingSymbols(symbols, query);
  
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
  
  // 多个匹配，需要进一步消歧
  if (matches.length > 1) {
    // 如果指定了索引，使用索引选择
    if (query.index !== undefined) {
      if (query.index < 0 || query.index >= matches.length) {
        return {
          success: false,
          error: {
            type: 'invalid_query',
            message: `Index ${query.index} out of range. Found ${matches.length} matches (0-${matches.length - 1}).`,
            suggestions: {
              overloadOptions: matches.map(({ symbol, path }) => 
                formatSymbolDescription(symbol, path)
              ),
            },
          },
        };
      }
      
      const selected = matches[query.index];
      return {
        success: true,
        position: {
          // LSP position 是 0-based，转换为 1-based
          line: selected.symbol.selectionRange.start.line + 1,
          character: selected.symbol.selectionRange.start.character + 1,
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
        message: `Found ${matches.length} symbols named '${query.name}'. Please specify --signature or --index to disambiguate.`,
        suggestions: {
          overloadOptions: matches.map(({ symbol, path }) => 
            formatSymbolDescription(symbol, path)
          ),
        },
      },
    };
  }
  
  // 唯一匹配
  const match = matches[0];
  return {
    success: true,
    position: {
      // LSP position 是 0-based，转换为 1-based
      line: match.symbol.selectionRange.start.line + 1,
      character: match.symbol.selectionRange.start.character + 1,
      confidence: 'exact',
      matchedSymbol: match.path,
    },
  };
}

/**
 * 从命令行选项构建 SymbolQuery
 */
export function buildSymbolQuery(options: {
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
export function isSymbolMode(options: {
  method?: string;
  symbol?: string;
}): boolean {
  return !!(options.method || options.symbol);
}
