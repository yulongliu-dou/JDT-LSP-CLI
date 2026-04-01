/**
 * LSP 协议连接管理
 * 
 * 负责：
 * - 创建和维护 LSP 连接
 * - 发送 LSP 请求
 * - 处理 LSP 通知
 */

import { ChildProcess } from 'child_process';
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  DidOpenTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DefinitionRequest,
  ReferencesRequest,
  DocumentSymbolRequest,
  HoverRequest,
  ImplementationRequest,
  TypeDefinitionRequest,
  CallHierarchyPrepareRequest,
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  WorkspaceSymbolRequest,
} from 'vscode-languageserver-protocol';
import { CLIOptions } from '../core/types';

export interface LspConnection {
  connection: MessageConnection;
  process: ChildProcess;
  initialized: boolean;
}

export class LspConnectionManager {
  private connection: MessageConnection | null = null;
  private process: ChildProcess | null = null;
  private initialized = false;
  private options: CLIOptions;

  constructor(options: CLIOptions) {
    this.options = options;
  }

  /**
   * 日志输出
   */
  private log(message: string, ...args: any[]) {
    if (this.options.verbose) {
      console.error(`[LSP-CONN] ${message}`, ...args);
    }
  }

  /**
   * 创建 LSP 连接
   */
  createConnection(process: ChildProcess): MessageConnection {
    this.process = process;
    
    this.connection = createMessageConnection(
      new StreamMessageReader(process.stdout!),
      new StreamMessageWriter(process.stdin!)
    );

    this.connection.listen();
    return this.connection;
  }

  /**
   * 发送初始化请求
   */
  async initialize(projectPath: string): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not established');
    }

    const initParams = {
      processId: process.pid,
      rootUri: `file://${projectPath.replace(/\\/g, '/')}`,
      rootPath: projectPath,
      capabilities: {
        textDocument: {
          callHierarchy: { dynamicRegistration: true },
          definition: { dynamicRegistration: true, linkSupport: true },
          references: { dynamicRegistration: true },
          documentSymbol: {
            dynamicRegistration: true,
            hierarchicalDocumentSymbolSupport: true,
          },
          implementation: { dynamicRegistration: true, linkSupport: true },
          hover: { dynamicRegistration: true, contentFormat: ['plaintext', 'markdown'] },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        {
          uri: `file://${projectPath.replace(/\\/g, '/')}`,
          name: 'root',
        },
      ],
    };

    this.log('Sending initialize request...');
    await this.connection.sendRequest(InitializeRequest.type.method, initParams);

    // 发送 initialized 通知
    await this.connection.sendNotification(InitializedNotification.type.method);
    
    this.initialized = true;
    this.log('JDT LS initialized');
  }

  /**
   * 打开文档
   */
  async openDocument(filePath: string, content: string): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    await this.connection.sendNotification(DidOpenTextDocumentNotification.type.method, {
      textDocument: {
        uri: `file://${filePath.replace(/\\/g, '/')}`,
        languageId: 'java',
        version: 1,
        text: content,
      },
    });
  }

  /**
   * 关闭文档
   */
  async closeDocument(filePath: string): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    await this.connection.sendNotification(DidCloseTextDocumentNotification.type.method, {
      textDocument: {
        uri: `file://${filePath.replace(/\\/g, '/')}`,
      },
    });
  }

  /**
   * 获取定义
   */
  async getDefinition(filePath: string, line: number, col: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(DefinitionRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  /**
   * 获取引用
   */
  async getReferences(filePath: string, line: number, col: number, includeDeclaration: boolean) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(ReferencesRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
      context: { includeDeclaration },
    });
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(filePath: string) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(DocumentSymbolRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
    });
  }

  /**
   * 获取 Hover 信息
   */
  async getHover(filePath: string, line: number, col: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(HoverRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  /**
   * 获取实现
   */
  async getImplementations(filePath: string, line: number, col: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(ImplementationRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  /**
   * 获取类型定义
   */
  async getTypeDefinition(filePath: string, line: number, col: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(TypeDefinitionRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  /**
   * 准备工作区符号
   */
  async getWorkspaceSymbols(query: string, limit?: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    const result = await this.connection.sendRequest(WorkspaceSymbolRequest.type.method, { query });
    
    // 如果需要限制数量
    if (limit && Array.isArray(result)) {
      return result.slice(0, limit);
    }
    
    return result;
  }

  /**
   * 准备调用层级
   */
  async prepareCallHierarchy(filePath: string, line: number, col: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(CallHierarchyPrepareRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  /**
   * 获取 incoming calls
   */
  async getIncomingCalls(item: any) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(CallHierarchyIncomingCallsRequest.type.method, { item });
  }

  /**
   * 获取 outgoing calls
   */
  async getOutgoingCalls(item: any) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(CallHierarchyOutgoingCallsRequest.type.method, { item });
  }

  /**
   * 关闭连接
   */
  async stop(): Promise<void> {
    if (this.connection) {
      try {
        // 发送 shutdown 请求
        await this.connection.sendRequest(ShutdownRequest.type.method);
        
        // 发送 exit 通知
        await this.connection.sendNotification(ExitNotification.type.method);
        
        this.connection.dispose();
        this.connection = null;
        this.initialized = false;
        
        this.log('LSP connection closed');
      } catch (error) {
        this.log('Error closing connection:', error);
      }
    }

    // 终止进程
    if (this.process) {
      try {
        this.process.kill();
      } catch (error) {
        // ignore
      }
      this.process = null;
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 获取连接对象
   */
  getConnection(): MessageConnection | null {
    return this.connection;
  }

  /**
   * 获取进程对象
   */
  getProcess(): ChildProcess | null {
    return this.process;
  }
}
