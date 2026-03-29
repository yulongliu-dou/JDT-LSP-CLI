/**
 * 符号解析器 - 将符号标识符转换为精确位置
 * 
 * 支持:
 * - 基于符号名称定位（无重载场景）
 * - 基于签名区分重载方法（支持模糊匹配）
 * - 基于容器路径定位嵌套符号（匿名类/Lambda）
 * - 基于索引定位多个同名符号
 * - 泛型类型模糊匹配
 * - 智能位置选择（针对不同命令优化）
 */

import { SymbolQuery, ResolvedPosition, SymbolResolutionError, SymbolInfo } from './types';

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
 * JDT LS 返回的 detail 格式: "methodName(String orderId, int quantity) : void"
 */
export function extractSignature(detail: string | undefined): string {
  if (!detail) return '';
  const match = detail.match(/\(([^)]*)\)/);
  return match ? match[1] : '';
}

/**
 * 提取简化的签名（用于用户友好的显示）
 * 例: "String orderId, int quantity" -> "(String, int)"
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
 * 例: "List<String>" -> "List", "Map<String, Integer>" -> "Map"
 */
export function normalizeGenericType(typeName: string): string {
  if (!typeName) return '';
  // 移除泛型参数: List<String> -> List
  // 处理嵌套泛型: List<Map<String, Integer>> -> List
  return typeName.replace(/<[^<>]*>/g, '').replace(/<.*$/g, '').trim();
}

/**
 * 规范化签名字符串（移除空格、参数名，只保留类型）
 * 例: "String orderId, int quantity" -> "string,int"
 * 支持泛型模糊匹配: "List<String>" -> "list"
 */
export function normalizeSignature(signature: string, stripGenerics: boolean = true): string {
  if (!signature) return '';
  
  return signature
    .split(',')
    .map(param => {
      const trimmed = param.trim();
      // 提取类型名（处理泛型和数组）
      const parts = trimmed.split(/\s+/);
      let typeName = parts[0] || '';
      // 可选：移除泛型参数
      if (stripGenerics) {
        typeName = normalizeGenericType(typeName);
      }
      return typeName;
    })
    .filter(Boolean)
    .join(',')
    .toLowerCase();
}

/**
 * 检查符号签名是否匹配查询（支持模糊匹配）
 * 
 * 支持两种查询格式:
 * - 带括号: "(String, int)" - 用户友好的格式
 * - 不带括号: "String, int" - 内部处理格式
 * 
 * @param symbolDetail - 符号的 detail 字段（可能包含签名和返回类型）
 * @param querySignature - 用户查询的签名
 * @param symbolName - 可选的符号名称（用于从 name 中提取签名，如 "methodName(Type, int)"）
 */
export function matchSignature(symbolDetail: string | undefined, querySignature: string, symbolName?: string): boolean {
  // 从 symbolDetail 提取签名（从 "methodName(String, int) : void" 提取 "String, int"）
  let symbolSigFromDetail = extractSignature(symbolDetail);
  
  // 如果 detail 中没有签名（如 documentSymbol 返回的 detail 只有返回类型），尝试从 name 中提取
  if (!symbolSigFromDetail && symbolName) {
    symbolSigFromDetail = extractSignature(symbolName);
  }
  
  // 从 querySignature 提取签名（处理带括号和不带括号的情况）
  // 如果用户传入 "(boolean)"，需要提取为 "boolean"
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
  
  // 部分匹配（查询签名是符号签名的子串）
  if (symbolSig.includes(querySig) || querySig.includes(symbolSig)) return true;
  
  return false;
}

/**
 * 模糊匹配符号名称（支持泛型类名）
 * 例: "List" 匹配 "List<String>", "UserService" 匹配 "UserService"
 */
export function fuzzyMatchName(symbolName: string, queryName: string): boolean {
  if (!symbolName || !queryName) return false;
  
  // 精确匹配
  if (symbolName === queryName) return true;
  
  // 泛型模糊匹配：移除泛型后比较
  const normalizedSymbol = normalizeGenericType(symbolName);
  const normalizedQuery = normalizeGenericType(queryName);
  if (normalizedSymbol === normalizedQuery) return true;
  
  // 前缀匹配（用于部分输入）
  if (normalizedSymbol.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedSymbol)) {
    return true;
  }
  
  return false;
}

/**
 * 获取最优位置（根据命令类型智能选择）
 * - hover: 使用 selectionRange 中间位置（避免边界问题）
 * - 其他: 使用 selectionRange 起始位置
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
    // 如果是同一行，取中间字符位置
    if (selectionRange.start.line === selectionRange.end.line) {
      const midChar = Math.floor((startChar + endChar) / 2);
      return {
        line: selectionRange.start.line + 1,  // 转换为 1-based
        character: midChar + 1,
      };
    }
  }
  
  // 其他命令使用起始位置
  return {
    line: selectionRange.start.line + 1,      // 转换为 1-based
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
      // 到达叶子节点，返回空数组表示没有子符号
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
    // 名称匹配（支持模糊匹配）
    if (!fuzzyMatchName(symbol.name, query.name)) return false;
    
    // 类型匹配（如果指定）
    if (query.kind && symbol.kind !== query.kind) return false;
    
    // 签名匹配（如果指定）- 已支持模糊匹配
    if (query.signature && !matchSignature(symbol.detail, query.signature, symbol.name)) {
      return false;
    }
    
    return true;
  });
}

/**
 * 从符号的 detail 字段提取返回类型
 * JDT LS 返回的 detail 格式: "methodName(String orderId, int quantity) : void"
 * 返回: "void"
 */
function extractReturnType(detail: string | undefined): string {
  if (!detail) return '';
  const match = detail.match(/:\s*(.+)$/);
  return match ? match[1].trim() : '';
}

/**
 * 生成符号描述（用于错误提示）
 * 
 * 格式: "name [kind] - signature : returnType"
 * 示例: "process [Method] - process(String, int) : boolean"
 */
function formatSymbolDescription(symbol: SymbolInfo, path: string): string {
  const kindStr = symbol.kind ? ` [${symbol.kind}]` : '';
  
  // 对于方法，显示完整签名和返回类型
  if (symbol.kind === 'Method' || symbol.kind === 'Constructor') {
    const signature = extractSimpleSignature(symbol.detail);
    const returnType = extractReturnType(symbol.detail);
    const returnStr = returnType ? ` : ${returnType}` : '';
    // 使用 path（包含类名和方法名）而不是仅 symbol.name
    return `${path}${kindStr} - ${path.split('.').pop()}${signature}${returnStr}`;
  }
  
  // 对于其他类型，只显示名称和类型
  return `${path}${kindStr}`;
}

/**
 * 从方法名中提取签名部分
 * 例: "resolveTypeHandler(Type, JdbcType, String)" -> "(Type, JdbcType, String)"
 */
function extractSignatureFromName(name: string): string {
  const match = name.match(/\((.*)\)$/);
  return match ? `(${match[1]})` : '()';
}

/**
 * 生成用于 overloadOptions 的符号描述（包含索引）
 * 
 * 格式: "[index] name [kind] - signature : returnType"
 * 示例: "[0] resolveTypeHandler [Method] - (Type, JdbcType, String) : TypeHandler<?>"
 */
function formatOverloadOption(symbol: SymbolInfo, path: string, index: number): string {
  const kindStr = symbol.kind ? ` [${symbol.kind}]` : '';
  const fullName = path.split('.').pop() || symbol.name;
  
  // 对于方法，显示完整签名和返回类型
  if (symbol.kind === 'Method' || symbol.kind === 'Constructor') {
    const returnType = extractReturnType(symbol.detail);
    const returnStr = returnType ? ` : ${returnType}` : '';
    // 从 fullName 中提取纯方法名（去掉括号及其后面的内容）
    const simpleName = fullName.split('(')[0];
    // 从 name 字段提取签名（因为 documentSymbol 的签名在 name 中）
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
 * @param command - 命令类型（用于智能位置选择）
 * @returns 解析结果（成功返回位置，失败返回错误信息）
 */
export function resolveSymbol(
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
  
  // 唯一匹配 - 直接返回（模糊匹配的核心优化）
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
  
  // 多个匹配，需要进一步消歧
  // 如果指定了索引，使用索引选择
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
  
  // 未指定索引且有多个匹配，返回歧义错误（提供简化签名帮助 AI 选择）
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
