/**
 * JDT Language Server Client (精简版)
 * 
 * 整合：
 * - JdtLauncher（进程启动）
 * - LspConnectionManager（LSP 连接）
 * - 高级 API（文档管理、符号查询等）
 */

import { ChildProcess } from 'child_process';
import { CLIOptions, SymbolKindMap, JvmConfig, DaemonConfig } from '../core/types';
import { JdtLauncher } from './launcher';
import { LspConnectionManager } from './lspConnection';

export class JdtLsClient {
  private launcher: JdtLauncher;
  private connectionManager: LspConnectionManager;
  private options: CLIOptions;
  private initialized = false;
  private openedFiles = new Set<string>();
  private progressCallback?: (stage: string, percent: number, message: string) => void;

  constructor(options: CLIOptions, jvmConfig?: Partial<JvmConfig>) {
    this.options = {
      timeout: 60000,
      verbose: false,
      ...options,
    };
    
    this.launcher = new JdtLauncher(this.options, jvmConfig);
    this.connectionManager = new LspConnectionManager(this.options);
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback: (stage: string, percent: number, message: string) => void): void {
    this.progressCallback = callback;
  }

  /**
   * 日志输出
   */
  private log(message: string, ...args: any[]) {
    if (this.options.verbose) {
      console.error(`[JDT-CLIENT] ${message}`, ...args);
    }
  }

  /**
   * 报告进度
   */
  private reportProgress(stage: string, percent: number, message: string): void {
    if (this.progressCallback) {
      this.progressCallback(stage, percent, message);
    }
  }

  /**
   * 启动 JDT LS 并初始化
   */
  async start(): Promise<void> {
    if (this.connectionManager.getConnection()) {
      return;
    }

    this.reportProgress('starting', 0, '启动 JDT LS...');
    
    // 1. 启动 Java 进程
    const launchResult = await this.launcher.launch();
    
    this.reportProgress('jdt-launching', 30, 'JDT LS 进程已启动');

    // 2. 创建 LSP 连接
    const connection = this.connectionManager.createConnection(launchResult.process);
    
    this.reportProgress('initializing', 50, '建立 LSP 连接...');

    // 3. 初始化
    await this.connectionManager.initialize(this.options.projectPath);
    
    this.initialized = true;
    this.reportProgress('ready', 100, 'JDT LS 就绪');
    
    this.log('JDT LS started successfully');
  }

  /**
   * 打开文档
   */
  async openDocument(filePath: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }

    // 如果已经打开，直接返回内容
    if (this.openedFiles.has(filePath)) {
      this.log('Document already opened:', filePath);
      return '';
    }

    // 读取文件内容
    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');

    // 发送打开通知
    await this.connectionManager.openDocument(filePath, content);
    this.openedFiles.add(filePath);
    
    this.log('Document opened:', filePath);
    return content;
  }

  /**
   * 关闭文档
   */
  async closeDocument(filePath: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }

    if (!this.openedFiles.has(filePath)) {
      return;
    }

    await this.connectionManager.closeDocument(filePath);
    this.openedFiles.delete(filePath);
    
    this.log('Document closed:', filePath);
  }

  /**
   * 获取定义
   */
  async getDefinition(filePath: string, line: number, col: number): Promise<any> {
    await this.openDocument(filePath);
    try {
      return await this.connectionManager.getDefinition(filePath, line, col);
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取引用
   */
  async getReferences(filePath: string, line: number, col: number, includeDeclaration: boolean): Promise<any[]> {
    await this.openDocument(filePath);
    try {
      return await this.connectionManager.getReferences(filePath, line, col, includeDeclaration) as any[];
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(filePath: string): Promise<any[]> {
    await this.openDocument(filePath);
    try {
      return await this.connectionManager.getDocumentSymbols(filePath) as any[];
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取 Hover 信息
   */
  async getHover(filePath: string, line: number, col: number): Promise<any> {
    await this.openDocument(filePath);
    try {
      return await this.connectionManager.getHover(filePath, line, col);
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取实现
   */
  async getImplementations(filePath: string, line: number, col: number): Promise<any[]> {
    await this.openDocument(filePath);
    try {
      return await this.connectionManager.getImplementations(filePath, line, col) as any[];
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取类型定义
   */
  async getTypeDefinition(filePath: string, line: number, col: number, explainEmpty?: boolean): Promise<any> {
    await this.openDocument(filePath);
    try {
      const result = await this.connectionManager.getTypeDefinition(filePath, line, col);
      
      // 如果需要解释空结果
      if (explainEmpty && (!result || (Array.isArray(result) && result.length === 0))) {
        return {
          locations: [],
          explanation: 'Type definition not available for this position. This might be a local variable or primitive type.',
        };
      }
      
      return result;
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取工作区符号
   */
  async getWorkspaceSymbols(query: string, limit?: number): Promise<any[]> {
    return await this.connectionManager.getWorkspaceSymbols(query, limit) as any[];
  }

  /**
   * 准备调用层级
   */
  async prepareCallHierarchy(filePath: string, line: number, col: number): Promise<any[]> {
    await this.openDocument(filePath);
    try {
      return await this.connectionManager.prepareCallHierarchy(filePath, line, col) as any[];
    } finally {
      await this.closeDocument(filePath);
    }
  }

  /**
   * 获取 incoming calls
   */
  async getIncomingCalls(item: any): Promise<any[]> {
    return await this.connectionManager.getIncomingCalls(item) as any[];
  }

  /**
   * 获取 outgoing calls
   */
  async getOutgoingCalls(item: any): Promise<any[]> {
    return await this.connectionManager.getOutgoingCalls(item) as any[];
  }

  /**
   * 停止 JDT LS
   */
  async stop(): Promise<void> {
    this.log('Stopping JDT LS...');
    await this.connectionManager.stop();
    this.initialized = false;
    this.openedFiles.clear();
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 获取 JVM 配置
   */
  getJvmConfig(): JvmConfig {
    return this.launcher['jvmConfig'];
  }

  /**
   * 获取 Java 可执行文件路径
   */
  getJavaExecutable(): string {
    return this.launcher.getJavaExecutable();
  }
}

// 重新导出配置相关函数
export { loadConfig, generateConfigTemplate, DEFAULT_JVM_CONFIG, CONFIG_DIR, CONFIG_FILE } from './configLoader';
