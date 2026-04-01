/**
 * 工作空间服务
 * 
 * 功能：
 * - 全局符号搜索
 * - 项目范围的文件搜索
 * - 工作空间配置管理
 */

import { LspConnectionManager } from '../jdt/lspConnection';
import { SymbolInfo, Location } from '../core/types';

/**
 * 工作空间符号查询参数
 */
export interface WorkspaceSymbolQuery {
  query: string;
  maxResults?: number;
}

/**
 * 工作空间服务类
 */
export class WorkspaceService {
  private connection: LspConnectionManager;

  constructor(connection: LspConnectionManager) {
    this.connection = connection;
  }

  /**
   * 在工作空间中搜索符号
   */
  async searchSymbols(query: WorkspaceSymbolQuery): Promise<SymbolInfo[]> {
    const maxResults = query.maxResults ?? 50;
    
    const symbols = await this.connection.getWorkspaceSymbols(query.query);
    
    if (!symbols) {
      return [];
    }

    // 限制结果数量
    return (symbols as SymbolInfo[]).slice(0, maxResults);
  }

  /**
   * 查找工作空间中的所有引用
   */
  async findWorkspaceReferences(
    filePath: string,
    line: number,
    col: number
  ): Promise<Location[]> {
    // 使用 references 请求（已包含工作空间范围）
    const references = await this.connection.getReferences(filePath, line, col, true);
    
    if (!references) {
      return [];
    }

    return this.normalizeLocations(references);
  }

  /**
   * 获取工作空间信息
   */
  getWorkspaceInfo(): { projectPath: string } | null {
    // TODO: 从连接或配置中提取工作空间信息
    return null;
  }

  /**
   * 规范化 Location 数组
   */
  private normalizeLocations(result: any): Location[] {
    if (!result) return [];
    
    // 单个 Location
    if (result.uri && result.range) {
      return [result as Location];
    }
    
    // Location 数组
    if (Array.isArray(result)) {
      return result as Location[];
    }
    
    return [];
  }
}
