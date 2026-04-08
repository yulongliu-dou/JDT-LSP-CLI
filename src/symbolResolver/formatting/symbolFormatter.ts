/**
 * 符号格式化
 * 
 * 提供符号描述生成、重载选项格式化等功能
 */

import { SymbolInfo } from '../../core/types';
import { extractSimpleSignature, extractReturnType, extractSignatureFromName } from '../signature/signatureExtractor';

/**
 * 生成符号描述（用于错误提示）
 * 
 * 格式: "name [kind] - signature : returnType"
 * 示例: "process [Method] - process(String, int) : boolean"
 */
export function formatSymbolDescription(symbol: SymbolInfo, path: string): string {
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
 * 生成用于 overloadOptions 的符号描述（包含索引）
 * 
 * 格式: "[index] name [kind] - signature : returnType"
 * 示例: "[0] resolveTypeHandler [Method] - (Type, JdbcType, String) : TypeHandler<?>"
 */
export function formatOverloadOption(symbol: SymbolInfo, path: string, index: number): string {
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
