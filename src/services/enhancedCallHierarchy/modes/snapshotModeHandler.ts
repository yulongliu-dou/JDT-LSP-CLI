/**
 * Snapshot模式处理器
 * 
 * 处理完整快照生成，支持：
 * - 生成完整调用树
 * - 创建快照目录结构
 * - 生成索引文件（index.txt）
 * - 生成源码文件（sources/*.java）
 * - 生成元数据（manifest.json）
 */

import * as fs from 'fs';
import * as path from 'path';
import { CallHierarchyItem, CallHierarchyQuery, MethodNode, SnapshotCallHierarchyResult } from '../../../core/types';
import { LspConnectionManager } from '../../../jdt/lspConnection';
import { CallTreeBuilder } from '../tree/callTreeBuilder';
import { createMethodNode, extractSourceCode } from '../core/nodeFactory';

/**
 * Snapshot模式处理器类
 */
export class SnapshotModeHandler {
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
   * 执行Snapshot模式
   */
  async execute(query: CallHierarchyQuery, prepareEntry: () => Promise<CallHierarchyItem | null>): Promise<SnapshotCallHierarchyResult> {
    const entry = await prepareEntry();
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

    const entryNode = createMethodNode(entry, 0, undefined);
    visited.set(entryNode.id, entryNode);

    await this.treeBuilder.buildCompleteTree(
      entry,
      0,
      maxDepth,
      visited,
      callGraph,
      query.direction || 'outgoing'
    );

    // 生成索引文件
    const indexContent = this.generateIndexFile(entryNode, visited, callGraph);
    fs.writeFileSync(indexPath, indexContent, 'utf-8');

    // 生成源码文件
    const methodsWithPaths = Array.from(visited.values()).filter(m => m.uri.startsWith('file://'));
    for (const method of methodsWithPaths) {
      const sourceFile = path.join(sourceDirPath, `${method.id}.java`);
      const sourceCode = extractSourceCode(method);
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
}
