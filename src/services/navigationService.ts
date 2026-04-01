/**
 * 导航服务
 * 
 * 功能：
 * - 跳转到定义
 * - 跳转到实现
 * - 跳转到类型定义
 * - 查找引用
 * - 智能文档打开/关闭管理
 */

import { LspConnectionManager } from '../jdt/lspConnection';
import { SymbolService } from './symbolService';
import { SymbolInfo, Location } from '../core/types';

/**
 * 导航结果
 */
export interface NavigationResult {
  locations: Location[];
  message?: string;
}

/**
 * 导航服务类
 */
export class NavigationService {
  private connection: LspConnectionManager;
  private symbolService: SymbolService;
  private openDocuments: Set<string>;

  constructor(connection: LspConnectionManager) {
    this.connection = connection;
    this.symbolService = new SymbolService();
    this.openDocuments = new Set();
  }

  /**
   * 跳转到定义（支持符号解析）
   */
  async getDefinition(
    filePath: string,
    line: number,
    col: number,
    useSymbolMode?: boolean
  ): Promise<NavigationResult> {
    await this.ensureDocumentOpen(filePath);
    
    try {
      const definition = await this.connection.getDefinition(filePath, line, col);
      
      if (!definition) {
        return {
          locations: [],
          message: 'No definition found',
        };
      }

      // 处理返回结果（可能是 Location 或 Location[]）
      const locations = this.normalizeLocations(definition);
      
      return {
        locations,
      };
    } finally {
      // 如果不是持续编辑的文件，可以关闭
      // this.closeDocumentIfSafe(filePath);
    }
  }

  /**
   * 跳转到实现
   */
  async getImplementation(filePath: string, line: number, col: number): Promise<NavigationResult> {
    await this.ensureDocumentOpen(filePath);
    
    try {
      const implementation = await this.connection.getImplementations(filePath, line, col);
      
      if (!implementation) {
        return {
          locations: [],
          message: 'No implementations found',
        };
      }

      const locations = this.normalizeLocations(implementation);
      
      return {
        locations,
      };
    } finally {
      // this.closeDocumentIfSafe(filePath);
    }
  }

  /**
   * 跳转到类型定义
   */
  async getTypeDefinition(filePath: string, line: number, col: number): Promise<NavigationResult> {
    await this.ensureDocumentOpen(filePath);
    
    try {
      const typeDefinition = await this.connection.getTypeDefinition(filePath, line, col);
      
      if (!typeDefinition) {
        return {
          locations: [],
          message: 'No type definition found',
        };
      }

      const locations = this.normalizeLocations(typeDefinition);
      
      return {
        locations,
      };
    } finally {
      // this.closeDocumentIfSafe(filePath);
    }
  }

  /**
   * 查找所有引用
   */
  async getReferences(
    filePath: string,
    line: number,
    col: number,
    includeDeclaration: boolean = true
  ): Promise<NavigationResult> {
    await this.ensureDocumentOpen(filePath);
    
    try {
      const references = await this.connection.getReferences(filePath, line, col, includeDeclaration);
      
      if (!references) {
        return {
          locations: [],
          message: 'No references found',
        };
      }

      const locations = this.normalizeLocations(references);
      
      // 过滤声明
      if (!includeDeclaration) {
        const filteredLocations = locations.filter(loc => {
          // 简单过滤：如果位置和查询位置相同，则是声明
          return !(loc.range.start.line === line - 1 && loc.range.start.character === col - 1);
        });
        
        return {
          locations: filteredLocations,
        };
      }
      
      return {
        locations,
      };
    } finally {
      // this.closeDocumentIfSafe(filePath);
    }
  }

  /**
   * 获取悬停信息
   */
  async getHover(filePath: string, line: number, col: number): Promise<string | null> {
    await this.ensureDocumentOpen(filePath);
    
    try {
      const hover = await this.connection.getHover(filePath, line, col) as any;
      
      if (!hover || !(hover as any).contents) {
        return null;
      }

      // 提取 Markdown 内容
      if (Array.isArray((hover as any).contents)) {
        return (hover as any).contents.map((c: any) => this.extractContent(c)).join('\n');
      }
      
      return this.extractContent((hover as any).contents);
    } finally {
      // this.closeDocumentIfSafe(filePath);
    }
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(filePath: string): Promise<SymbolInfo[]> {
    await this.ensureDocumentOpen(filePath);
    
    try {
      const symbols = await this.connection.getDocumentSymbols(filePath);
      return (symbols || []) as SymbolInfo[];
    } finally {
      // this.closeDocumentIfSafe(filePath);
    }
  }

  /**
   * 确保文档已打开
   */
  private async ensureDocumentOpen(filePath: string): Promise<void> {
    if (!this.openDocuments.has(filePath)) {
      await this.connection.openDocument(filePath, '');
      this.openDocuments.add(filePath);
    }
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

  /**
   * 提取 Markdown 内容
   */
  private extractContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    
    if (content.kind === 'markdown') {
      return content.value;
    }
    
    if (content.kind === 'plaintext') {
      return content.value;
    }
    
    return JSON.stringify(content);
  }

  /**
   * 安全关闭文档（可选功能）
   */
  async closeDocumentIfSafe(filePath: string): Promise<void> {
    // TODO: 实现智能关闭逻辑
    // 例如：检查是否有其他操作正在使用该文档
    if (this.openDocuments.has(filePath)) {
      await this.connection.closeDocument(filePath);
      this.openDocuments.delete(filePath);
    }
  }

  /**
   * 清理所有打开的文档
   */
  async cleanup(): Promise<void> {
    for (const filePath of Array.from(this.openDocuments)) {
      await this.closeDocumentIfSafe(filePath);
    }
  }
}
