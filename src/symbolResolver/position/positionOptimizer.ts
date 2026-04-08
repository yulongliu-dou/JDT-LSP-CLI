/**
 * 位置优化
 * 
 * 根据命令类型智能选择最优位置
 */

import { SymbolInfo } from '../../core/types';

/**
 * 命令类型（用于智能位置选择）
 */
export type CommandType = 'hover' | 'definition' | 'references' | 'implementations' | 'call-hierarchy';

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
