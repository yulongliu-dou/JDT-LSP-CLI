/**
 * SymbolKind 映射工具
 * 
 * LSP协议规定SymbolKind是数字枚举(1-26)，此模块提供数字与字符串之间的双向转换。
 * 
 * 参考: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
 */

/**
 * SymbolKind 数字到字符串的映射表
 */
export const SymbolKindMap: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter'
};

/**
 * 反向映射：字符串到数字
 */
export const SymbolKindReverseMap: Record<string, number> = Object.entries(SymbolKindMap).reduce(
  (acc, [key, value]) => {
    acc[value] = parseInt(key);
    return acc;
  },
  {} as Record<string, number>
);

/**
 * 将 SymbolKind 数字转换为字符串
 * 
 * @param kind - SymbolKind 数字或字符串
 * @returns 字符串形式的 SymbolKind (如 "Class", "Method")
 * 
 * @example
 * symbolKindToString(5)  // 返回 "Class"
 * symbolKindToString(6)  // 返回 "Method"
 * symbolKindToString("Class")  // 返回 "Class" (已经是字符串)
 */
export function symbolKindToString(kind: number | string | undefined): string {
  if (kind === undefined || kind === null) {
    return 'Unknown';
  }
  
  // 如果已经是字符串，直接返回
  if (typeof kind === 'string') {
    return kind;
  }
  
  // 数字转字符串
  return SymbolKindMap[kind] || `Unknown(${kind})`;
}

/**
 * 将字符串转换为 SymbolKind 数字
 * 
 * @param kind - SymbolKind 字符串 (如 "Class", "Method")
 * @returns SymbolKind 数字，如果不匹配返回 undefined
 * 
 * @example
 * stringToSymbolKind("Class")  // 返回 5
 * stringToSymbolKind("Method")  // 返回 6
 * stringToSymbolKind("class")   // 返回 5 (不区分大小写)
 */
export function stringToSymbolKind(kind: string): number | undefined {
  if (!kind) return undefined;
  
  // 尝试直接查找（不区分大小写）
  const normalized = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
  return SymbolKindReverseMap[normalized];
}

/**
 * 验证 SymbolKind 是否有效
 * 
 * @param kind - SymbolKind 数字或字符串
 * @returns 是否有效
 */
export function isValidSymbolKind(kind: number | string): boolean {
  if (typeof kind === 'number') {
    return kind >= 1 && kind <= 26;
  }
  return kind in SymbolKindReverseMap;
}

/**
 * 获取所有支持的 SymbolKind 字符串列表
 */
export function getSupportedSymbolKinds(): string[] {
  return Object.values(SymbolKindMap);
}

/**
 * 获取 SymbolKind 的显示信息
 * 
 * @param kind - SymbolKind 数字
 * @returns 包含数字和字符串的显示信息
 */
export function getSymbolKindDisplay(kind: number): { value: number; label: string } {
  return {
    value: kind,
    label: symbolKindToString(kind)
  };
}
