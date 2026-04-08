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
