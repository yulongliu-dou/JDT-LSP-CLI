/**
 * 签名提取和规范化
 * 
 * 提供从符号 detail 字段提取签名、规范化签名等功能
 */

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
 * 使用智能分割正确处理泛型内逗号
 */
export function extractSimpleSignature(detail: string | undefined): string {
  const sig = extractSignature(detail);
  if (!sig) return '()';
  
  // 使用智能分割处理泛型内逗号
  const params = smartSplitSignature(sig);
  const types = params
    .map(param => {
      const parts = param.trim().split(/\s+/);
      return normalizeGenericType(parts[0] || '');
    })
    .filter(Boolean);
  
  return `(${types.join(', ')})`;
}

/**
 * 规范化泛型类型（移除泛型参数）
 * 例: "List<String>" -> "List", "Map<String, Integer>" -> "Map"
 * 支持深层嵌套泛型: "Map<String, List<Map<String, Integer>>>" -> "Map"
 */
export function normalizeGenericType(typeName: string): string {
  if (!typeName) return '';
  // 使用循环处理嵌套泛型（剥洋葱式移除）
  // 单次 replace 只能处理最内层，循环直到不再变化
  let result = typeName;
  let prevResult;
  do {
    prevResult = result;
    result = result.replace(/<[^<>]*>/g, '');
  } while (result !== prevResult);
  return result.replace(/<.*$/g, '').trim();
}

/**
 * 智能分割签名参数（忽略泛型内的逗号）
 * 例: "List<String>, Map<String, Integer>" -> ["List<String>", "Map<String, Integer>"]
 */
export function smartSplitSignature(signature: string): string[] {
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
 * 规范化单个类型（用于签名规范化）
 */
function normalizeSingleType(typeName: string, stripGenerics: boolean): string {
  let type = typeName.trim();
  if (stripGenerics) {
    type = normalizeGenericType(type);
  }
  return type.toLowerCase();
}

/**
 * 规范化签名字符串（移除空格、参数名，只保留类型）
 * 例: "String orderId, int quantity" -> "string,int"
 * 支持泛型模糊匹配: "List<String>" -> "list"
 * 使用智能分割处理泛型内逗号: "Map<String, Integer>, List<String>" -> "map,list"
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
 * 从符号的 detail 字段提取返回类型
 * JDT LS 返回的 detail 格式: "methodName(String orderId, int quantity) : void"
 * 返回: "void"
 */
export function extractReturnType(detail: string | undefined): string {
  if (!detail) return '';
  const match = detail.match(/:\s*(.+)$/);
  return match ? match[1].trim() : '';
}

/**
 * 从方法名中提取签名部分
 * 例: "resolveTypeHandler(Type, JdbcType, String)" -> "(Type, JdbcType, String)"
 */
export function extractSignatureFromName(name: string): string {
  const match = name.match(/\((.*)\)$/);
  return match ? `(${match[1]})` : '()';
}
