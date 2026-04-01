/**
 * 调用层级服务
 * 
 * 功能：
 * - 获取方法的调用者（父调用链）
 * - 获取方法调用的其他方法（子调用链）
 * - 支持分页逐层获取（为未来复杂功能预留）
 * - 缓存管理（避免重复请求）
 */

import { CallHierarchyItem, Position } from '../core/types';
import { LspConnectionManager } from '../jdt/lspConnection';

/**
 * 分页参数
 */
export interface PageOptions {
  page: number;        // 页码（从 0 开始）
  pageSize: number;    // 每页大小
}

/**
 * 分页结果
 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * 调用层级缓存项
 */
interface CacheItem {
  item: CallHierarchyItem;
  incomingCalls?: CallHierarchyItem[];
  outgoingCalls?: CallHierarchyItem[];
  timestamp: number;
}

/**
 * 调用层级服务类
 */
export class CallHierarchyService {
  private connection: LspConnectionManager;
  private cache: Map<string, CacheItem>;
  private cacheTTL: number;  // 缓存过期时间（毫秒）

  constructor(connection: LspConnectionManager, cacheTTL: number = 5 * 60 * 1000) {
    this.connection = connection;
    this.cache = new Map();
    this.cacheTTL = cacheTTL;
  }

  /**
   * 准备调用层级（获取起始节点）
   */
  async prepareCallHierarchy(filePath: string, line: number, col: number): Promise<CallHierarchyItem | null> {
    const result = await this.connection.prepareCallHierarchy(filePath, line, col);
    return result as CallHierarchyItem | null;
  }

  /**
   * 获取父调用链（谁调用了这个方法）
   */
  async getIncomingCalls(item: CallHierarchyItem): Promise<CallHierarchyItem[]> {
    const cacheKey = this.getCacheKey(item, 'incoming');
    
    // 检查缓存
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // 请求 LSP
    const calls = await this.connection.getIncomingCalls(item);
    const typedCalls = (calls || []) as CallHierarchyItem[];
    
    // 缓存结果
    this.setCached(cacheKey, typedCalls);
    
    return typedCalls;
  }

  /**
   * 获取子调用链（这个方法调用了谁）
   */
  async getOutgoingCalls(item: CallHierarchyItem): Promise<CallHierarchyItem[]> {
    const cacheKey = this.getCacheKey(item, 'outgoing');
    
    // 检查缓存
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // 请求 LSP
    const calls = await this.connection.getOutgoingCalls(item);
    const typedCalls = (calls || []) as CallHierarchyItem[];
    
    // 缓存结果
    this.setCached(cacheKey, typedCalls);
    
    return typedCalls;
  }

  /**
   * 分页获取父调用链（为未来复杂场景预留）
   */
  async getIncomingCallsPaged(
    item: CallHierarchyItem, 
    options?: PageOptions
  ): Promise<PageResult<CallHierarchyItem>> {
    const allCalls = await this.getIncomingCalls(item);
    return this.paginate(allCalls, options);
  }

  /**
   * 分页获取子调用链（为未来复杂场景预留）
   */
  async getOutgoingCallsPaged(
    item: CallHierarchyItem, 
    options?: PageOptions
  ): Promise<PageResult<CallHierarchyItem>> {
    const allCalls = await this.getOutgoingCalls(item);
    return this.paginate(allCalls, options);
  }

  /**
   * 递归获取完整调用树（谨慎使用，可能导致大量数据）
   */
  async getCallTree(
    filePath: string,
    line: number,
    col: number,
    maxDepth: number = 5
  ): Promise<CallHierarchyTreeNode | null> {
    const root = await this.prepareCallHierarchy(filePath, line, col);
    if (!root) return null;

    return await this.buildCallTree(root, 0, maxDepth);
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 构建树节点
   */
  private async buildCallTree(
    item: CallHierarchyItem,
    currentDepth: number,
    maxDepth: number
  ): Promise<CallHierarchyTreeNode> {
    const node: CallHierarchyTreeNode = {
      item,
      depth: currentDepth,
      children: [],
    };

    if (currentDepth >= maxDepth) {
      return node;
    }

    // 获取子调用（这个方法调用了谁）
    const outgoingCalls = await this.getOutgoingCalls(item);
    
    // 递归构建子树
    for (const call of outgoingCalls) {
      const childNode = await this.buildCallTree(call as CallHierarchyItem, currentDepth + 1, maxDepth);
      if (childNode) {
        node.children.push(childNode);
      }
    }

    return node;
  }

  /**
   * 通用分页函数
   */
  private paginate<T>(items: T[], options?: PageOptions): PageResult<T> {
    const page = options?.page ?? 0;
    const pageSize = options?.pageSize ?? 20;
    
    const start = page * pageSize;
    const end = start + pageSize;
    
    const pagedItems = items.slice(start, end);
    
    return {
      items: pagedItems,
      total: items.length,
      page,
      pageSize,
      hasMore: end < items.length,
    };
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(item: CallHierarchyItem, type: 'incoming' | 'outgoing'): string {
    const itemAny = item as any;
    return `${type}:${itemAny.data?.uri || ''}:${item.range?.start?.line || 0}:${item.name}`;
  }

  /**
   * 获取缓存
   */
  private getCached(key: string): CallHierarchyItem[] | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    // 检查是否过期
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    
    const incoming = key.startsWith('incoming') ? cached.incomingCalls : cached.outgoingCalls;
    return incoming || null;
  }

  /**
   * 设置缓存
   */
  private setCached(key: string, items: any[]): void {
    const existing = this.cache.get(key);
    const cacheItem: CacheItem = {
      item: existing?.item || {} as CallHierarchyItem,
      incomingCalls: key.startsWith('incoming') ? items : existing?.incomingCalls,
      outgoingCalls: key.startsWith('outgoing') ? items : existing?.outgoingCalls,
      timestamp: Date.now(),
    };
    this.cache.set(key, cacheItem);
  }
}

/**
 * 调用层级树节点
 */
export interface CallHierarchyTreeNode {
  item: CallHierarchyItem;
  depth: number;
  children: CallHierarchyTreeNode[];
}
