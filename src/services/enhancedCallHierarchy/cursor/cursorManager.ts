/**
 * 游标管理器
 * 
 * 管理调用链查询的游标生命周期，包括：
 * - 游标创建和ID生成
 * - 游标存储和检索
 * - 过期游标清理
 */

import * as crypto from 'crypto';
import { CallHierarchyCursor, MethodNode } from '../../../core/types';

/**
 * 游标管理器类
 */
export class CursorManager {
  private cursors: Map<string, CallHierarchyCursor>;
  private cursorTTL: number;  // 游标存活时间(毫秒)

  constructor(cursorTTL: number = 30 * 60 * 1000) {
    this.cursors = new Map();
    this.cursorTTL = cursorTTL;
  }

  /**
   * 创建新游标
   */
  createCursor(
    entryNode: MethodNode,
    maxDepth: number,
    direction: 'incoming' | 'outgoing'
  ): CallHierarchyCursor {
    const cursorId = this.generateCursorId();
    
    const cursor: CallHierarchyCursor = {
      id: cursorId,
      entry: entryNode,
      visited: new Map([[entryNode.id, entryNode]]),
      callGraph: new Map(),
      maxDepth,
      direction,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.cursorTTL,
    };

    this.cursors.set(cursorId, cursor);
    return cursor;
  }

  /**
   * 获取游标
   */
  getCursor(cursorId: string): CallHierarchyCursor | undefined {
    return this.cursors.get(cursorId);
  }

  /**
   * 生成游标ID
   */
  private generateCursorId(): string {
    return `ch_cursor_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * 清理过期游标
   */
  cleanupExpiredCursors(): void {
    const now = Date.now();
    for (const [id, cursor] of this.cursors.entries()) {
      if (now > cursor.expiresAt) {
        this.cursors.delete(id);
      }
    }
  }

  /**
   * 获取游标存活时间（秒）
   */
  getCursorTTLSeconds(): number {
    return this.cursorTTL / 1000;
  }
}
