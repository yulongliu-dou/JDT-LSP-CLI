/**
 * 签名和名称匹配逻辑
 * 
 * 提供签名匹配和名称模糊匹配功能
 */

import { normalizeSignature, normalizeGenericType, extractSignature } from '../signature/signatureExtractor';

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
  
  // 如果还是没有签名，说明 symbolDetail 本身就是签名（没有方法名）
  if (!symbolSigFromDetail && symbolDetail) {
    symbolSigFromDetail = symbolDetail;
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
  
  // 部分匹配（仅当参数数量相同时，允许前缀匹配用于泛型简化场景）
  // 例: "list<string>" 的 startsWith "list" 是合理的（同参数数量，泛型简化）
  // 但 "string" 不应 startsWith 匹配 "string,object"（不同参数数量，是不同重载）
  if (symbolSig && querySig && symbolSig.startsWith(querySig)) {
    const symbolParamCount = symbolSig.split(',').length;
    const queryParamCount = querySig.split(',').length;
    if (symbolParamCount === queryParamCount) return true;
  }
  
  return false;
}

/**
 * 模糊匹配符号名称（支持泛型类名）
 * 例: "List" 匹配 "List<String>", "UserService" 匹配 "UserService"
 * 支持: 大小写不敏感、子串匹配、驼峰↔下划线转换
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
