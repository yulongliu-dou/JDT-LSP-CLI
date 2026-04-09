/**
 * Lazy模式处理器
 * 
 * 处理游标驱动的Lazy模式查询，支持：
 * - 创建新的Lazy查询
 * - 继续使用游标探索
 * - 按需获取源码（fetch-source）
 * - 展开子调用（expand-depth）
 */

import * as path from 'path';
import { CallHierarchyItem, CallHierarchyQuery, CallHierarchyCursor, MethodNode, LazyCallHierarchyResult } from '../../../core/types';
import { LspConnectionManager } from '../../../jdt/lspConnection';
import { CursorManager } from '../cursor/cursorManager';
import { CallTreeBuilder } from '../tree/callTreeBuilder';
import { createMethodNode, toCallHierarchyItem, extractSourceCode } from '../core/nodeFactory';

/**
 * Lazy模式处理器类
 */
export class LazyModeHandler {
  private connection: LspConnectionManager;
  private cursorManager: CursorManager;
  private treeBuilder: CallTreeBuilder;

  constructor(
    connection: LspConnectionManager,
    cursorManager: CursorManager,
    treeBuilder: CallTreeBuilder
  ) {
    this.connection = connection;
    this.cursorManager = cursorManager;
    this.treeBuilder = treeBuilder;
  }

  /**
   * 执行Lazy模式（统一入口）
   */
  async execute(query: CallHierarchyQuery, prepareEntry: () => Promise<CallHierarchyItem | null>): Promise<LazyCallHierarchyResult> {
    // 清理过期游标
    this.cursorManager.cleanupExpiredCursors();

    // 如果有cursor,继续使用
    if (query.cursor) {
      return this.continueLazyMode(query);
    }

    // 否则创建新查询
    return this.createLazyMode(query, prepareEntry);
  }

  /**
   * 创建新的lazy查询
   */
  private async createLazyMode(
    query: CallHierarchyQuery,
    prepareEntry: () => Promise<CallHierarchyItem | null>
  ): Promise<LazyCallHierarchyResult> {
    const entry = await prepareEntry();
    if (!entry) {
      throw new Error('No call hierarchy item found at the specified location');
    }

    const entryNode = createMethodNode(entry, 0, undefined);
    const maxDepth = query.depth || 3;
    const direction = query.direction || 'outgoing';
    
    const cursor = this.cursorManager.createCursor(entryNode, maxDepth, direction);

    // 获取第一层调用
    const firstLevelMethods = await this.treeBuilder.fetchCallsForItem(entry, 0, {
      visited: cursor.visited,
      callGraph: cursor.callGraph,
      maxDepth: cursor.maxDepth,
      direction: cursor.direction,
    });

    return {
      mode: 'lazy',
      cursor: cursor.id,
      entry: entryNode,
      methods: firstLevelMethods,
      nextActions: this.generateNextActions(firstLevelMethods, cursor, 1),
      expiresInSeconds: this.cursorManager.getCursorTTLSeconds(),
      usageGuide: {
        description: 'Lazy模式：AI按需获取方法源码和展开子调用，节省token',
        howToUseCursor: `使用cursor "${cursor.id}" 在后续请求中继续探索，避免重复查询`,
        howToUseMethodIds: '方法ID（如entry, m1, m2）是唯一标识符，用于精确引用特定方法。ID与类名无关，仅用于引用。',
        nextActionsExplanation: 'nextActions中的格式为 "操作类型:方法ID列表"，例如 "fetch-source:m1,m2" 表示获取m1和m2的源码',
        example: '下一步: node jdt-lsp-cli ch --mode lazy --cursor ' + cursor.id + ' --fetch-source m1,m2'
      },
    };
  }

  /**
   * 继续lazy查询(使用cursor)
   */
  private async continueLazyMode(query: CallHierarchyQuery): Promise<LazyCallHierarchyResult> {
    const cursor = this.cursorManager.getCursor(query.cursor!);
    if (!cursor) {
      throw new Error(`Invalid or expired cursor: ${query.cursor}`);
    }

    const result: LazyCallHierarchyResult = {
      mode: 'lazy',
      cursor: cursor.id,
      entry: cursor.entry,
      methods: [],
      nextActions: [],
      expiresInSeconds: (cursor.expiresAt - Date.now()) / 1000,
      usageGuide: {
        description: 'Lazy模式：使用游标继续探索调用链',
        howToUseCursor: `继续使用cursor "${cursor.id}" 获取源码或展开子调用`,
        howToUseMethodIds: '方法ID（entry, m1, m2...）是唯一标识符，用于精确引用方法',
        nextActionsExplanation: '根据分析目标选择fetch-source读取源码或expand-depth展开子调用',
        example: '获取源码: node jdt-lsp-cli ch --mode lazy --cursor ' + cursor.id + ' --fetch-source m1,m2'
      },
    };

    // 处理fetchSource请求
    if (query.fetchSource && query.fetchSource.length > 0) {
      // 注意: AI自行读取源码,这里只返回文件路径信息
      result.methods = query.fetchSource
        .map(id => cursor.visited.get(id))
        .filter((m): m is MethodNode => m !== undefined);
      
      result.nextActions = [
        ...this.generateExpandActions(result.methods, cursor),
        'Done reading sources. Use expand-depth:<methodId> to explore deeper.',
      ];
    }

    // 处理expandDepth请求
    if (query.expandDepth && query.expandDepth.length > 0) {
      const expandedMethods: MethodNode[] = [];
      
      for (const methodId of query.expandDepth) {
        const method = cursor.visited.get(methodId);
        if (!method) continue;

        // 获取该方法的子调用
        const calls = await this.treeBuilder.fetchCallsForItem(
          toCallHierarchyItem(method),
          method.depth,
          {
            visited: cursor.visited,
            callGraph: cursor.callGraph,
            maxDepth: cursor.maxDepth,
            direction: cursor.direction,
          }
        );

        expandedMethods.push(...calls);
      }

      result.methods = expandedMethods;
      result.nextActions = this.generateNextActions(expandedMethods, cursor, 0);
    }

    return result;
  }

  /**
   * 生成下一步操作建议
   */
  private generateNextActions(
    methods: MethodNode[],
    cursor: CallHierarchyCursor,
    currentDepth: number
  ): string[] {
    const actions: string[] = [];

    if (methods.length > 0) {
      const methodIds = methods.map(m => m.id).join(',');
      actions.push(`fetch-source:${methodIds} - Read method source code`);
      
      // 只有未达到最大深度才建议展开
      if (currentDepth < cursor.maxDepth) {
        actions.push(`expand-depth:${methodIds} - Explore sub-calls`);
      }
    }

    return actions;
  }

  /**
   * 生成展开操作建议
   */
  private generateExpandActions(methods: MethodNode[], cursor: CallHierarchyCursor): string[] {
    const actions: string[] = [];

    for (const method of methods) {
      if (method.depth < cursor.maxDepth) {
        actions.push(`expand-depth:${method.id} - Explore ${method.name} sub-calls`);
      }
    }

    return actions;
  }
}
