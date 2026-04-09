/**
 * 调用树构建器
 * 
 * 负责构建完整的调用链树结构，支持：
 * - 递归构建调用树
 * - 获取方法的调用关系
 * - 调用图生成
 */

import { CallHierarchyItem, MethodNode } from '../../../core/types';
import { LspConnectionManager } from '../../../jdt/lspConnection';
import { createMethodNode, findMethodIdByItem, toCallHierarchyItem } from '../core/nodeFactory';

/**
 * 调用树构建器类
 */
export class CallTreeBuilder {
  private connection: LspConnectionManager;

  constructor(connection: LspConnectionManager) {
    this.connection = connection;
  }

  /**
   * 获取方法的调用
   */
  async fetchCallsForItem(
    item: CallHierarchyItem,
    parentDepth: number,
    cursor: {
      visited: Map<string, MethodNode>;
      callGraph: Map<string, string[]>;
      maxDepth: number;
      direction: 'incoming' | 'outgoing';
    }
  ): Promise<MethodNode[]> {
    if (parentDepth >= cursor.maxDepth) return [];

    const calls = cursor.direction === 'outgoing'
      ? await this.connection.getOutgoingCalls(item)
      : await this.connection.getIncomingCalls(item);

    const results: MethodNode[] = [];
    const parentId = findMethodIdByItem(cursor.visited, item);

    for (const call of (calls || []) as any[]) {
      const target = cursor.direction === 'outgoing' ? call.to : call.from;
      
      // 跳过jdt://虚拟URI(外部依赖)
      if (target.uri.includes('jdt://')) continue;

      const methodNode = createMethodNode(target, parentDepth + 1, parentId);
      
      // 避免重复
      if (!cursor.visited.has(methodNode.id)) {
        cursor.visited.set(methodNode.id, methodNode);
        
        // 更新调用图
        if (parentId) {
          const children = cursor.callGraph.get(parentId) || [];
          children.push(methodNode.id);
          cursor.callGraph.set(parentId, children);
        }

        results.push(methodNode);
      }
    }

    return results;
  }

  /**
   * 构建完整调用树
   */
  async buildCompleteTree(
    item: CallHierarchyItem,
    currentDepth: number,
    maxDepth: number,
    visited: Map<string, MethodNode>,
    callGraph: Map<string, string[]>,
    direction: 'incoming' | 'outgoing',
    callCount?: Map<string, number>
  ): Promise<void> {
    if (currentDepth >= maxDepth) return;

    const calls = direction === 'outgoing'
      ? await this.connection.getOutgoingCalls(item)
      : await this.connection.getIncomingCalls(item);

    const parentId = findMethodIdByItem(visited, item);

    for (const call of (calls || []) as any[]) {
      const target = direction === 'outgoing' ? call.to : call.from;
      
      if (target.uri.includes('jdt://')) continue;

      const methodNode = createMethodNode(target, currentDepth + 1, parentId);
      
      if (!visited.has(methodNode.id)) {
        visited.set(methodNode.id, methodNode);
        
        if (parentId) {
          const children = callGraph.get(parentId) || [];
          children.push(methodNode.id);
          callGraph.set(parentId, children);
        }

        // 递归构建子树
        await this.buildCompleteTree(target, currentDepth + 1, maxDepth, visited, callGraph, direction, callCount);
      } else if (callCount) {
        // 统计被调用次数
        const count = callCount.get(methodNode.id) || 0;
        callCount.set(methodNode.id, count + 1);
      }
    }
  }
}
