/**
 * 增强版调用链服务(AI友好)
 * 
 * 功能：
 * - lazy模式: 游标驱动,AI按需获取源码/展开子调用
 * - snapshot模式: 生成完整快照文件供AI分析
 * - summary模式: 智能摘要+热点识别+推荐
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CallHierarchyItem, Range } from '../core/types';
import {
  MethodNode,
  CallHierarchyCursor,
  CallHierarchyQuery,
  LazyCallHierarchyResult,
  SnapshotCallHierarchyResult,
  SummaryCallHierarchyResult,
  HotspotInfo,
  RecommendationInfo,
} from '../core/types';
import { LspConnectionManager } from '../jdt/lspConnection';
import { symbolKindToString } from '../core/utils/symbolKind';

/**
 * 增强版调用链服务
 */
export class EnhancedCallHierarchyService {
  private connection: LspConnectionManager;
  private cursors: Map<string, CallHierarchyCursor>;
  private cursorTTL: number;  // 游标存活时间(毫秒)
  private nodeCounter: number = 1;  // 用于生成简洁的方法ID

  constructor(connection: LspConnectionManager, cursorTTL: number = 30 * 60 * 1000) {
    this.connection = connection;
    this.cursors = new Map();
    this.cursorTTL = cursorTTL;
  }

  /**
   * 执行调用链查询(统一入口)
   */
  async executeQuery(query: CallHierarchyQuery): Promise<any> {
    // 清理过期游标
    this.cleanupExpiredCursors();

    switch (query.mode) {
      case 'lazy':
        return this.executeLazyMode(query);
      case 'snapshot':
        return this.executeSnapshotMode(query);
      case 'summary':
        return this.executeSummaryMode(query);
      default:
        throw new Error(`Unknown mode: ${query.mode}`);
    }
  }

  /**
   * Lazy模式: 游标驱动
   */
  private async executeLazyMode(query: CallHierarchyQuery): Promise<LazyCallHierarchyResult> {
    // 如果有cursor,继续使用
    if (query.cursor) {
      return this.continueLazyMode(query);
    }

    // 否则创建新查询
    return this.createLazyMode(query);
  }

  /**
   * 创建新的lazy查询
   */
  private async createLazyMode(query: CallHierarchyQuery): Promise<LazyCallHierarchyResult> {
    const entry = await this.prepareCallHierarchy(query.filePath, query.line, query.col);
    if (!entry) {
      throw new Error('No call hierarchy item found at the specified location');
    }

    const entryNode = this.createMethodNode(entry, 0, undefined);
    const cursorId = this.generateCursorId();
    
    const cursor: CallHierarchyCursor = {
      id: cursorId,
      entry: entryNode,
      visited: new Map([[entryNode.id, entryNode]]),
      callGraph: new Map(),
      maxDepth: query.depth || 3,
      direction: query.direction || 'outgoing',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.cursorTTL,
    };

    this.cursors.set(cursorId, cursor);

    // 获取第一层调用
    const firstLevelMethods = await this.fetchCallsForItem(entry, 0, cursor);

    return {
      mode: 'lazy',
      cursor: cursorId,
      entry: entryNode,
      methods: firstLevelMethods,
      nextActions: this.generateNextActions(firstLevelMethods, cursor, 1),
      expiresInSeconds: this.cursorTTL / 1000,
      usageGuide: {
        description: 'Lazy模式：AI按需获取方法源码和展开子调用，节省token',
        howToUseCursor: `使用cursor "${cursorId}" 在后续请求中继续探索，避免重复查询`,
        howToUseMethodIds: '方法ID（如entry, m1, m2）是唯一标识符，用于精确引用特定方法。ID与类名无关，仅用于引用。',
        nextActionsExplanation: 'nextActions中的格式为 "操作类型:方法ID列表"，例如 "fetch-source:m1,m2" 表示获取m1和m2的源码',
        example: '下一步: node jdt-lsp-cli ch --mode lazy --cursor ' + cursorId + ' --fetch-source m1,m2'
      },
    };
  }

  /**
   * 继续lazy查询(使用cursor)
   */
  private async continueLazyMode(query: CallHierarchyQuery): Promise<LazyCallHierarchyResult> {
    const cursor = this.cursors.get(query.cursor!);
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
        const calls = await this.fetchCallsForItem(
          this.toCallHierarchyItem(method),
          method.depth,
          cursor
        );

        expandedMethods.push(...calls);
      }

      result.methods = expandedMethods;
      result.nextActions = this.generateNextActions(expandedMethods, cursor, 0);
    }

    return result;
  }

  /**
   * Snapshot模式: 生成完整快照
   */
  private async executeSnapshotMode(query: CallHierarchyQuery): Promise<SnapshotCallHierarchyResult> {
    const entry = await this.prepareCallHierarchy(query.filePath, query.line, query.col);
    if (!entry) {
      throw new Error('No call hierarchy item found at the specified location');
    }

    const snapshotPath = query.snapshotPath || this.generateSnapshotPath();
    const sourceDirPath = path.join(snapshotPath, 'sources');
    const indexPath = path.join(snapshotPath, 'index.txt');
    const metadataPath = path.join(snapshotPath, 'manifest.json');

    // 创建目录
    fs.mkdirSync(sourceDirPath, { recursive: true });

    // 构建完整调用树
    const maxDepth = query.depth || 3;
    const visited = new Map<string, MethodNode>();
    const callGraph = new Map<string, string[]>();

    const entryNode = this.createMethodNode(entry, 0, undefined);
    visited.set(entryNode.id, entryNode);

    await this.buildCompleteTree(entry, 0, maxDepth, visited, callGraph, query.direction || 'outgoing');

    // 生成索引文件
    const indexContent = this.generateIndexFile(entryNode, visited, callGraph);
    fs.writeFileSync(indexPath, indexContent, 'utf-8');

    // 生成源码文件
    const methodsWithPaths = Array.from(visited.values()).filter(m => m.uri.startsWith('file://'));
    for (const method of methodsWithPaths) {
      const sourceFile = path.join(sourceDirPath, `${method.id}.java`);
      const sourceCode = this.extractSourceCode(method);
      if (sourceCode) {
        fs.writeFileSync(sourceFile, sourceCode, 'utf-8');
      }
    }

    // 生成元数据
    const metadata = {
      entry: `${entryNode.classPath}.${entryNode.name}`,
      totalMethods: visited.size,
      maxDepth,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return {
      mode: 'snapshot',
      snapshotPath,
      indexPath,
      sourceDirPath,
      metadata,
      usageGuide: {
        description: 'Snapshot模式：生成完整的调用链快照，包含调用索引和所有方法源码',
        fileStructure: `${snapshotPath}/
  ├── index.txt         - 调用链文本索引（树形结构，ID标注在每行末尾）
  ├── manifest.json     - 元数据（入口方法、方法总数、生成时间）
  └── sources/          - 所有方法的源码文件
      ├── entry.java    - 入口方法源码
      ├── m1.java       - 第1个被调用方法
      ├── m2.java       - 第2个被调用方法
      └── ...`,
        howToUse: [
          '1. 读取 index.txt 了解调用链结构',
          '2. 根据ID（entry, m1, m2）定位到 sources/ 下对应文件',
          '3. 按需读取源码文件进行深入分析',
          '4. 结合 index.txt 中的调用关系理解代码流程'
        ],
        methodIdFormat: '方法ID使用序号（entry, m1, m2, m3...）保证唯一性。entry是入口方法，m1/m2/m3是按遍历顺序编号的调用方法。ID与类名/方法名无关，仅用于引用。',
        example: `// AI分析示例
// 1. 读取索引了解结构
const index = readFileSync('${indexPath}', 'utf-8');
// 2. 读取m2.java分析newStatementHandler方法
const m2Source = readFileSync('${sourceDirPath}/m2.java', 'utf-8');
// 3. 分析并生成报告`
      },
    };
  }

  /**
   * Summary模式: 智能摘要
   */
  private async executeSummaryMode(query: CallHierarchyQuery): Promise<SummaryCallHierarchyResult> {
    const entry = await this.prepareCallHierarchy(query.filePath, query.line, query.col);
    if (!entry) {
      throw new Error('No call hierarchy item found at the specified location');
    }

    const entryNode = this.createMethodNode(entry, 0, undefined);
    const maxDepth = query.maxSummaryDepth || 2;
    
    // 构建调用树(限制深度)
    const visited = new Map<string, MethodNode>();
    const callGraph = new Map<string, string[]>();
    const callCount = new Map<string, number>();  // 统计被调用次数

    visited.set(entryNode.id, entryNode);
    await this.buildCompleteTree(entry, 0, maxDepth, visited, callGraph, query.direction || 'outgoing', callCount);

    // 分析热点
    const hotspots = this.analyzeHotspots(visited, callCount);
    
    // 识别外部依赖
    const externalDeps = this.identifyExternalDependencies(visited);

    // 生成推荐
    const recommendations = this.generateRecommendations(entryNode, visited, hotspots, callGraph);

    // 生成调用链文本摘要
    const callGraphSummary = this.generateCallGraphText(entryNode, visited, callGraph);

    // 统计信息
    const depthDistribution: Record<number, number> = {};
    for (const method of visited.values()) {
      depthDistribution[method.depth] = (depthDistribution[method.depth] || 0) + 1;
    }

    const uniqueClasses = new Set(Array.from(visited.values()).map((m: MethodNode) => m.classPath)).size;

    return {
      mode: 'summary',
      entry: entryNode,
      summary: {
        totalMethods: visited.size,
        totalClasses: uniqueClasses,
        depthDistribution,
        hotspots,
        externalDependencies: externalDeps,
      },
      recommendations,
      callGraphSummary,
      usageGuide: {
        description: 'Summary模式：智能摘要+热点识别+分析推荐，最省token',
        howToUseSummary: '查看summary统计了解整体规模，hotspots识别热点方法，recommendations获得分析建议，callGraphSummary查看调用链文本',
        whenToUseOtherModes: '如需深入分析具体方法，使用lazy模式按需获取源码；如需完整离线分析，使用snapshot模式生成快照文件',
        example: '深度分析: node jdt-lsp-cli ch --mode snapshot --depth 2 --snapshot-path /tmp/analysis\n按需读取: node jdt-lsp-cli ch --mode lazy --fetch-source m1,m2'
      },
    };
  }

  // ========== 辅助方法 ==========

  /**
   * 准备调用链入口
   */
  private async prepareCallHierarchy(filePath: string, line: number, col: number): Promise<CallHierarchyItem | null> {
    const result = await this.connection.prepareCallHierarchy(filePath, line, col);
    const items = result as CallHierarchyItem[];
    return items && items.length > 0 ? items[0] : null;
  }

  /**
   * 获取方法的调用
   */
  private async fetchCallsForItem(
    item: CallHierarchyItem,
    parentDepth: number,
    cursor: CallHierarchyCursor
  ): Promise<MethodNode[]> {
    if (parentDepth >= cursor.maxDepth) return [];

    const calls = cursor.direction === 'outgoing'
      ? await this.connection.getOutgoingCalls(item)
      : await this.connection.getIncomingCalls(item);

    const results: MethodNode[] = [];
    const parentId = this.findMethodIdByItem(cursor.visited, item);

    for (const call of (calls || []) as any[]) {
      const target = cursor.direction === 'outgoing' ? call.to : call.from;
      
      // 跳过jdt://虚拟URI(外部依赖)
      if (target.uri.includes('jdt://')) continue;

      const methodNode = this.createMethodNode(target, parentDepth + 1, parentId);
      
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
  private async buildCompleteTree(
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

    const parentId = this.findMethodIdByItem(visited, item);

    for (const call of (calls || []) as any[]) {
      const target = direction === 'outgoing' ? call.to : call.from;
      
      if (target.uri.includes('jdt://')) continue;

      const methodNode = this.createMethodNode(target, currentDepth + 1, parentId);
      
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

  /**
   * 创建方法节点
   */
  private createMethodNode(item: CallHierarchyItem, depth: number, callerId?: string): MethodNode {
    // 改进的ID生成策略: 使用序号保证唯一性,同时保持简洁
    const id = depth === 0 ? 'entry' : `m${this.nodeCounter++}`;
    const classPath = this.extractClassPath(item.uri, item.detail);
    const filePath = this.uriToFilePath(item.uri);

    return {
      id,
      name: item.name,
      kind: symbolKindToString(item.kind),
      detail: item.detail,
      uri: item.uri,
      range: item.range,
      classPath,
      depth,
      startLine: item.range.start.line + 1,  // 转换为1-based
      endLine: item.range.end.line + 1,
      filePath,
      children: [],
      callerId,
    };
  }

  /**
   * 提取类全路径
   */
  private extractClassPath(uri: string, detail?: string): string {
    if (detail) {
      // detail格式通常是 "com.example.MyClass"
      const match = detail.match(/([a-zA-Z0-9_.]+)/);
      if (match) return match[1];
    }

    // 从URI推断
    if (uri.startsWith('file://')) {
      const filePath = decodeURIComponent(uri.replace('file://', ''));
      const fileName = path.basename(filePath, '.java');
      return fileName;
    }

    return 'unknown';
  }

  /**
   * URI转文件路径
   */
  private uriToFilePath(uri: string): string | undefined {
    if (!uri.startsWith('file://')) return undefined;
    // Windows路径处理: file:///E:/path -> E:/path
    let filePath = decodeURIComponent(uri.replace('file://', ''));
    // 移除开头的斜杠(Windows: /E:/ -> E:/)
    if (filePath.startsWith('/') && filePath[2] === ':') {
      filePath = filePath.substring(1);
    }
    return filePath;
  }

  /**
   * 转换为CallHierarchyItem
   */
  private toCallHierarchyItem(method: MethodNode): CallHierarchyItem {
    return {
      name: method.name,
      kind: method.kind,
      detail: method.detail,
      uri: method.uri,
      range: method.range,
      selectionRange: method.range,
    };
  }

  /**
   * 根据item查找methodId
   */
  private findMethodIdByItem(visited: Map<string, MethodNode>, item: CallHierarchyItem): string | undefined {
    for (const [id, method] of visited) {
      if (method.uri === item.uri && 
          method.name === item.name && 
          method.range.start.line === item.range.start.line) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * 提取源码
   */
  private extractSourceCode(method: MethodNode): string | null {
    if (!method.filePath) return null;

    try {
      const content = fs.readFileSync(method.filePath, 'utf-8');
      const lines = content.split('\n');
      
      // range是0-based,提取时需要注意
      const startLine = method.range.start.line;
      const endLine = method.range.end.line;
      
      return lines.slice(startLine, endLine + 1).join('\n');
    } catch (error) {
      console.error(`Failed to read source for ${method.name}:`, error);
      return null;
    }
  }

  /**
   * 生成游标ID
   */
  private generateCursorId(): string {
    return `ch_cursor_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * 生成快照路径
   */
  private generateSnapshotPath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(process.env.TEMP || '/tmp', `call-snapshot-${timestamp}`);
  }

  /**
   * 生成索引文件
   */
  private generateIndexFile(
    entry: MethodNode,
    visited: Map<string, MethodNode>,
    callGraph: Map<string, string[]>
  ): string {
    const lines: string[] = [];
    
    lines.push(`[ENTRY] ${entry.classPath}.${entry.name} (line ${entry.startLine}-${entry.endLine})`);
    lines.push('');

    // 按深度排序
    const sortedMethods = Array.from(visited.values()).sort((a, b) => a.depth - b.depth);

    for (const method of sortedMethods) {
      if (method.depth === 0) continue;

      const indent = '  '.repeat(method.depth);
      const children = callGraph.get(method.id) || [];
      const childrenInfo = children.length > 0 ? ` [${children.length} children]` : '';
      
      lines.push(`${indent}→ [${method.id}] ${method.classPath}.${method.name} (line ${method.startLine}-${method.endLine})${childrenInfo}`);
    }

    lines.push('');
    lines.push(`Total methods: ${visited.size}`);
    lines.push(`Source files: ./sources/`);

    return lines.join('\n');
  }

  /**
   * 分析热点
   */
  private analyzeHotspots(
    visited: Map<string, MethodNode>,
    callCount: Map<string, number>
  ): HotspotInfo[] {
    const hotspots: HotspotInfo[] = [];

    for (const [methodId, count] of callCount.entries()) {
      if (count >= 2) {  // 被调用2次及以上视为热点
        const method = visited.get(methodId);
        if (method) {
          hotspots.push({
            methodId,
            name: method.name,
            classPath: method.classPath,
            reason: `被${count + 1}个方法调用`,
            callCount: count + 1,
          });
        }
      }
    }

    return hotspots.sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * 识别外部依赖
   */
  private identifyExternalDependencies(visited: Map<string, MethodNode>): string[] {
    const externalDeps = new Set<string>();

    for (const method of visited.values()) {
      if (method.uri.includes('jdt://') && method.detail) {
        externalDeps.add(method.detail);
      }
    }

    return Array.from(externalDeps);
  }

  /**
   * 生成推荐
   */
  private generateRecommendations(
    entry: MethodNode,
    visited: Map<string, MethodNode>,
    hotspots: HotspotInfo[],
    callGraph: Map<string, string[]>
  ): RecommendationInfo[] {
    const recommendations: RecommendationInfo[] = [];

    // 推荐热点方法
    for (const hotspot of hotspots.slice(0, 3)) {
      recommendations.push({
        action: '深入分析',
        methodId: hotspot.methodId,
        methodName: hotspot.name,
        reason: `核心逻辑,${hotspot.reason}`,
        priority: 'high',
      });
    }

    // 推荐叶子方法(没有子调用的方法)
    for (const [methodId, children] of callGraph.entries()) {
      if (children.length === 0) {
        const method = visited.get(methodId);
        if (method && method.depth > 0) {
          recommendations.push({
            action: '查看',
            methodId,
            methodName: method.name,
            reason: '叶子方法,可能是关键实现',
            priority: 'medium',
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * 生成调用链文本摘要
   */
  private generateCallGraphText(
    entry: MethodNode,
    visited: Map<string, MethodNode>,
    callGraph: Map<string, string[]>
  ): string {
    const lines: string[] = [];
    lines.push(`${entry.classPath}.${entry.name}`);

    const visited_set = new Set<string>();
    const truncated = this.buildCallGraphTextRecursive(entry.id, callGraph, visited, visited_set, lines, 0, 50);

    if (truncated) {
      lines.push(`\n... (还有更多调用,使用lazy或snapshot模式查看完整内容)`);
    }

    return lines.join('\n');
  }

  private buildCallGraphTextRecursive(
    methodId: string,
    callGraph: Map<string, string[]>,
    visited: Map<string, MethodNode>,
    visitedSet: Set<string>,
    lines: string[],
    depth: number,
    maxLines: number = 100
  ): boolean {
    if (visitedSet.has(methodId)) return false;
    visitedSet.add(methodId);

    const method = visited.get(methodId);
    if (!method) return false;

    const children = callGraph.get(methodId) || [];
    const indent = '  '.repeat(depth);
    let truncated = false;

    for (const childId of children) {
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      
      const child = visited.get(childId);
      if (child) {
        lines.push(`${indent}→ ${child.classPath}.${child.name}`);
        const childTruncated = this.buildCallGraphTextRecursive(childId, callGraph, visited, visitedSet, lines, depth + 1, maxLines);
        truncated = truncated || childTruncated;
      }
    }

    return truncated;
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

  /**
   * 清理过期游标
   */
  private cleanupExpiredCursors(): void {
    const now = Date.now();
    for (const [id, cursor] of this.cursors.entries()) {
      if (now > cursor.expiresAt) {
        this.cursors.delete(id);
      }
    }
  }
}
