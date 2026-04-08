/**
 * 符号查找逻辑
 * 
 * 提供符号树遍历、容器查找、符号匹配等功能
 */

import { SymbolQuery, SymbolInfo } from '../../core/types';
import { fuzzyMatchName } from './signatureMatcher';
import { matchSignature } from './signatureMatcher';

/**
 * 构建符号的完整路径
 */
export function buildSymbolPath(symbol: SymbolInfo, parentPath: string = ''): string {
  const path = parentPath ? `${parentPath}.${symbol.name}` : symbol.name;
  return path;
}

/**
 * 收集符号树中所有符号的扁平列表（带路径信息）
 */
export function collectAllSymbols(
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
export function findContainer(
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
export function findMatchingSymbols(
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
 * 查找相似名称的符号（用于错误提示）
 * 注意：此函数需要调用方提供格式化函数，以避免循环依赖
 */
export function findSimilarNames(
  symbols: SymbolInfo[],
  targetName: string,
  maxResults: number = 5,
  formatFn?: (symbol: SymbolInfo, path: string) => string
): string[] {
  const allSymbols = collectAllSymbols(symbols);
  const targetLower = targetName.toLowerCase();
  
  const similarSymbols = allSymbols
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
    .slice(0, maxResults);
  
  // 如果提供了格式化函数，使用它；否则返回路径
  if (formatFn) {
    return similarSymbols.map(({ symbol, path }) => formatFn(symbol, path));
  }
  return similarSymbols.map(({ path }) => path);
}
