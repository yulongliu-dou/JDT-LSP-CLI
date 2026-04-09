/**
 * Summary模式处理器
 * 
 * 处理智能摘要生成，支持：
 * - 热点分析（被多次调用的方法）
 * - 外部依赖识别
 * - 分析推荐生成
 * - 调用链文本摘要
 */

import { CallHierarchyItem, CallHierarchyQuery, MethodNode, SummaryCallHierarchyResult, HotspotInfo, RecommendationInfo } from '../../../core/types';
import { LspConnectionManager } from '../../../jdt/lspConnection';
import { CallTreeBuilder } from '../tree/callTreeBuilder';
import { createMethodNode } from '../core/nodeFactory';

/**
 * Summary模式处理器类
 */
export class SummaryModeHandler {
  private connection: LspConnectionManager;
  private treeBuilder: CallTreeBuilder;

  constructor(
    connection: LspConnectionManager,
    treeBuilder: CallTreeBuilder
  ) {
    this.connection = connection;
    this.treeBuilder = treeBuilder;
  }

  /**
   * 执行Summary模式
   */
  async execute(query: CallHierarchyQuery, prepareEntry: () => Promise<CallHierarchyItem | null>): Promise<SummaryCallHierarchyResult> {
    const entry = await prepareEntry();
    if (!entry) {
      throw new Error('No call hierarchy item found at the specified location');
    }

    const entryNode = createMethodNode(entry, 0, undefined);
    const maxDepth = query.maxSummaryDepth || 2;
    
    // 构建调用树(限制深度)
    const visited = new Map<string, MethodNode>();
    const callGraph = new Map<string, string[]>();
    const callCount = new Map<string, number>();  // 统计被调用次数

    visited.set(entryNode.id, entryNode);
    await this.treeBuilder.buildCompleteTree(
      entry,
      0,
      maxDepth,
      visited,
      callGraph,
      query.direction || 'outgoing',
      callCount
    );

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

  /**
   * 递归构建调用链文本
   */
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
}
