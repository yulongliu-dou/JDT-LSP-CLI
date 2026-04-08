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
