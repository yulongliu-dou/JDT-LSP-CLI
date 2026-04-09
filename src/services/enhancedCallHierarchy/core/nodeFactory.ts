/**
 * 节点工厂和工具方法
 * 
 * 提供方法节点创建、URI转换、源码提取等工具功能
 */

import * as fs from 'fs';
import * as path from 'path';
import { CallHierarchyItem, MethodNode } from '../../../core/types';
import { symbolKindToString } from '../../../core/utils/symbolKind';

/**
 * 节点计数器（用于生成简洁的方法ID）
 */
let nodeCounter: number = 1;

/**
 * 重置节点计数器（用于测试或新查询）
 */
export function resetNodeCounter(): void {
  nodeCounter = 1;
}

/**
 * 创建方法节点
 */
export function createMethodNode(item: CallHierarchyItem, depth: number, callerId?: string): MethodNode {
  // 改进的ID生成策略: 使用序号保证唯一性,同时保持简洁
  const id = depth === 0 ? 'entry' : `m${nodeCounter++}`;
  const classPath = extractClassPath(item.uri, item.detail);
  const filePath = uriToFilePath(item.uri);

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
export function extractClassPath(uri: string, detail?: string): string {
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
export function uriToFilePath(uri: string): string | undefined {
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
export function toCallHierarchyItem(method: MethodNode): CallHierarchyItem {
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
export function findMethodIdByItem(
  visited: Map<string, MethodNode>,
  item: CallHierarchyItem
): string | undefined {
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
export function extractSourceCode(method: MethodNode): string | null {
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
