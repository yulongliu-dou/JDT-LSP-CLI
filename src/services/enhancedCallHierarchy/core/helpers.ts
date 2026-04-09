/**
 * 辅助函数
 * 
 * 提供调用链服务的辅助功能
 */

import { CallHierarchyItem } from '../../../core/types';
import { LspConnectionManager } from '../../../jdt/lspConnection';

/**
 * 准备调用链入口
 */
export async function prepareCallHierarchy(
  connection: LspConnectionManager,
  filePath: string,
  line: number,
  col: number
): Promise<CallHierarchyItem | null> {
  const result = await connection.prepareCallHierarchy(filePath, line, col);
  const items = result as CallHierarchyItem[];
  return items && items.length > 0 ? items[0] : null;
}
