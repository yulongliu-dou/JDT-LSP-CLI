/**
 * 辅助函数
 * 
 * 提供调用链服务的辅助功能
 */

import { CallHierarchyItem } from '../../../core/types';
import { LspConnectionManager } from '../../../jdt/lspConnection';
import * as crypto from 'crypto';

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

/**
 * 生成方法的唯一ID
 * 
 * @param uri - 文件URI
 * @param methodName - 方法名
 * @param line - 行号
 * @returns 唯一ID字符串
 */
export function generateMethodId(uri: string, methodName: string, line: number): string {
  const content = `${uri}:${methodName}:${line}`;
  return crypto.createHash('md5').update(content).digest('hex');
}
