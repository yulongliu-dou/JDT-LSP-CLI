/**
 * 增强版调用链服务(AI友好)
 * 
 * 功能：
 * - lazy模式: 游标驱动,AI按需获取源码/展开子调用
 * - snapshot模式: 生成完整快照文件供AI分析
 * - summary模式: 智能摘要+热点识别+推荐
 * 
 * 重构说明：
 * 本文件已重构为模块化架构，原有功能已迁移到以下模块：
 * - src/services/enhancedCallHierarchy/cursor/cursorManager.ts - 游标管理
 * - src/services/enhancedCallHierarchy/core/nodeFactory.ts - 节点工厂和工具
 * - src/services/enhancedCallHierarchy/tree/callTreeBuilder.ts - 调用树构建
 * - src/services/enhancedCallHierarchy/modes/lazyModeHandler.ts - Lazy模式处理
 * - src/services/enhancedCallHierarchy/modes/snapshotModeHandler.ts - Snapshot模式处理
 * - src/services/enhancedCallHierarchy/modes/summaryModeHandler.ts - Summary模式处理
 * 
 * 本文件现在作为编排器，委托给各模块处理具体逻辑
 */

import { CallHierarchyQuery } from '../core/types';
import { LspConnectionManager } from '../jdt/lspConnection';
import { CursorManager } from './enhancedCallHierarchy/cursor/cursorManager';
import { CallTreeBuilder } from './enhancedCallHierarchy/tree/callTreeBuilder';
import { LazyModeHandler } from './enhancedCallHierarchy/modes/lazyModeHandler';
import { SnapshotModeHandler } from './enhancedCallHierarchy/modes/snapshotModeHandler';
import { SummaryModeHandler } from './enhancedCallHierarchy/modes/summaryModeHandler';
import { prepareCallHierarchy } from './enhancedCallHierarchy/core/helpers';

/**
 * 增强版调用链服务
 */
export class EnhancedCallHierarchyService {
  private cursorManager: CursorManager;
  private treeBuilder: CallTreeBuilder;
  private lazyHandler: LazyModeHandler;
  private snapshotHandler: SnapshotModeHandler;
  private summaryHandler: SummaryModeHandler;
  private connection: LspConnectionManager;

  constructor(connection: LspConnectionManager, cursorTTL: number = 30 * 60 * 1000) {
    this.connection = connection;
    
    // 初始化各模块
    this.cursorManager = new CursorManager(cursorTTL);
    this.treeBuilder = new CallTreeBuilder(connection);
    this.lazyHandler = new LazyModeHandler(connection, this.cursorManager, this.treeBuilder);
    this.snapshotHandler = new SnapshotModeHandler(connection, this.treeBuilder);
    this.summaryHandler = new SummaryModeHandler(connection, this.treeBuilder);
  }

  /**
   * 执行调用链查询(统一入口)
   */
  async executeQuery(query: CallHierarchyQuery): Promise<any> {
    // 清理过期游标
    this.cursorManager.cleanupExpiredCursors();

    // 准备调用链入口的辅助函数
    const prepareEntry = async () => {
      return prepareCallHierarchy(this.connection, query.filePath, query.line, query.col);
    };

    switch (query.mode) {
      case 'lazy':
        return this.lazyHandler.execute(query, prepareEntry);
      case 'snapshot':
        return this.snapshotHandler.execute(query, prepareEntry);
      case 'summary':
        return this.summaryHandler.execute(query, prepareEntry);
      default:
        throw new Error(`Unknown mode: ${query.mode}`);
    }
  }
}
