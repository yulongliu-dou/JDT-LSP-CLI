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
  SemanticTokensRequest,
  PublishDiagnosticsNotification,
  RenameRequest,
  InlayHintRequest,
  CodeActionRequest,
  DocumentHighlightRequest,
  CodeLensRequest,
  CompletionRequest,
  SignatureHelpRequest,
  DeclarationRequest,
  DocumentFormattingRequest,
  PrepareRenameRequest,
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
  private progressHandler?: (params: any) => void;
  private diagnosticsStore = new Map<string, any[]>();
  private serverCapabilities: any = null;

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

    // 拦截 $/progress 通知用于索引进度追踪
    this.connection.onNotification('$/progress', (params: any) => {
      if (this.progressHandler) {
        this.progressHandler(params);
      }
    });

    // 拦截 textDocument/publishDiagnostics 用于收集诊断信息
    this.connection.onNotification(PublishDiagnosticsNotification.type.method, (params: any) => {
      const uri = params?.uri || '';
      this.diagnosticsStore.set(uri, params?.diagnostics || []);
    });

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
          rename: { dynamicRegistration: true, prepareSupport: true },
          semanticTokens: {
            dynamicRegistration: true,
            tokenTypes: [
              'namespace', 'type', 'class', 'enum', 'interface',
              'struct', 'typeParameter', 'parameter', 'variable',
              'property', 'enumMember', 'event', 'function', 'method',
              'macro', 'keyword', 'modifier', 'comment', 'string',
              'number', 'regexp', 'operator', 'decorator',
            ],
            tokenModifiers: [
              'declaration', 'definition', 'readonly', 'static',
              'deprecated', 'abstract', 'async', 'modification',
              'documentation', 'defaultLibrary',
            ],
            formats: ['relative'],
            requests: { full: { delta: true }, range: true },
          },
          inlayHint: { dynamicRegistration: true },
          codeAction: { dynamicRegistration: true },
          documentHighlight: { dynamicRegistration: true },
          codeLens: { dynamicRegistration: true },
          completion: { dynamicRegistration: true },
          signatureHelp: { dynamicRegistration: true },
          declaration: { dynamicRegistration: true, linkSupport: true },
          formatting: { dynamicRegistration: true },
          prepareRename: { dynamicRegistration: true },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      // JDT LS 专用扩展能力：声明客户端支持 `java/classFileContents`，
      // 否则 JDT 不会返回 jdt:// URI 可解析的文本内容。
      // 参见 SP01 Task 1.8。
      initializationOptions: {
        extendedClientCapabilities: {
          classFileContentsSupport: true,
          overrideTypeDefinition: true,
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
    const initResult: any = await this.connection.sendRequest(InitializeRequest.type.method, initParams);
    this.serverCapabilities = initResult?.capabilities || null;
    this.log('JDT LS capabilities received');

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
   *
   * 已知问题：JDT LS 1.58.0 对 textDocument/typeDefinition 返回不符合 JSON-RPC 2.0
   * 规范的响应（有 id 但缺少 result/error 封装），vscode-jsonrpc 会拒绝该响应。
   * 此处 catch 特定错误并返回空数组作为降级处理。
   */
  async getTypeDefinition(filePath: string, line: number, col: number) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    try {
      return await this.connection.sendRequest(TypeDefinitionRequest.type.method, {
        textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
        position: { line: line - 1, character: col - 1 },
      });
    } catch (e: any) {
      if (e?.message?.includes('neither a result nor an error')) {
        this.log('textDocument/typeDefinition: JDT LS returned malformed JSON-RPC response, returning empty array');
        return [];
      }
      throw e;
    }
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

    const result = await this.connection.sendRequest(CallHierarchyIncomingCallsRequest.type.method, { item });
    
    // LSP规范允许返回null，统一转换为空数组
    if (!result || !Array.isArray(result)) {
      return [];
    }
    
    return result;
  }

  /**
   * 获取 outgoing calls
   */
  async getOutgoingCalls(item: any) {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    const result = await this.connection.sendRequest(CallHierarchyOutgoingCallsRequest.type.method, { item });
    
    // LSP规范允许返回null，统一转换为空数组
    if (!result || !Array.isArray(result)) {
      return [];
    }
    
    return result;
  }

  /**
   * 拉取 jdt:// URI 的 class 文件文本（JDT LS 扩展请求 `java/classFileContents`）。
   *
   * 依赖初始化时声明 `extendedClientCapabilities.classFileContentsSupport=true`。
   * 见 SP01 Task 1.8。
   */
  async getClassFileContents(uri: string): Promise<string> {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }
    const result = await this.connection.sendRequest<string>('java/classFileContents', { uri });
    return typeof result === 'string' ? result : '';
  }

  /**
   * 获取文件诊断信息（编译错误/警告）
   *
   * JDT LS 通过 textDocument/publishDiagnostics 通知推送诊断，
   * 因此需要先打开文档，等待服务器推送，再收集结果。
   */
  async getDiagnostics(filePath: string): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    // 清除旧诊断
    this.diagnosticsStore.delete(uri);

    // 打开文档触发服务器推送诊断
    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    await this.connection.sendNotification(DidOpenTextDocumentNotification.type.method, {
      textDocument: { uri, languageId: 'java', version: 1, text: content },
    });

    // 等待诊断推送（最多等 5 秒）
    const startTime = Date.now();
    const maxWaitMs = 5000;
    const pollIntervalMs = 200;
    while (Date.now() - startTime < maxWaitMs) {
      const diags = this.diagnosticsStore.get(uri);
      if (diags !== undefined) {
        // 关闭文档
        await this.connection.sendNotification(DidCloseTextDocumentNotification.type.method, {
          textDocument: { uri },
        });
        return diags;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    // 超时：关闭文档，返回空数组
    try {
      await this.connection.sendNotification(DidCloseTextDocumentNotification.type.method, {
        textDocument: { uri },
      });
    } catch { /* ignore */ }
    return [];
  }

  /**
   * 获取文件语义 Token（精确类型标注）
   */
  async getSemanticTokens(filePath: string): Promise<any> {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    const result = await this.connection.sendRequest(SemanticTokensRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
    });
    return result;
  }

  /**
   * 语义重命名 - 返回 WorkspaceEdit
   */
  async getRename(filePath: string, line: number, col: number, newName: string): Promise<any> {
    if (!this.connection || !this.initialized) {
      throw new Error('Not initialized');
    }

    return this.connection.sendRequest(RenameRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
      newName,
    });
  }

  async getInlayHint(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(InlayHintRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      range: { start: { line: line - 1, character: col - 1 }, end: { line: line - 1, character: col - 1 } },
    });
  }

  async getCodeAction(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(CodeActionRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      range: { start: { line: line - 1, character: col - 1 }, end: { line: line - 1, character: col - 1 } },
      context: { diagnostics: [] },
    });
  }

  async getDocumentHighlight(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(DocumentHighlightRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  async getCodeLens(filePath: string): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(CodeLensRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
    });
  }

  async getCompletion(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(CompletionRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  async getSignatureHelp(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(SignatureHelpRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  async getDeclaration(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(DeclarationRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  async getFormatting(filePath: string): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(DocumentFormattingRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      options: { tabSize: 4, insertSpaces: true },
    });
  }

  async getPrepareRename(filePath: string, line: number, col: number): Promise<any> {
    if (!this.connection || !this.initialized) throw new Error('Not initialized');
    return this.connection.sendRequest(PrepareRenameRequest.type.method, {
      textDocument: { uri: `file://${filePath.replace(/\\/g, '/')}` },
      position: { line: line - 1, character: col - 1 },
    });
  }

  /**
   * 获取服务器 capabilities（initialize 结果）
   */
  getServerCapabilities(): any {
    return this.serverCapabilities;
  }

  /**
   * 获取语义令牌图例（tokenType 名称 + tokenModifier 名称）
   */
  getSemanticTokensLegend(): { tokenTypes: string[]; tokenModifiers: string[] } | null {
    return this.serverCapabilities?.semanticTokensProvider?.legend || null;
  }

  /**
   * 关闭连接（带超时保护，确保进程终止）
   */
  async stop(timeoutMs: number = 10000): Promise<void> {
    // 先尝试优雅关闭
    if (this.connection) {
      try {
        await Promise.race([
          this.connection.sendRequest(ShutdownRequest.type.method),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs),
          ),
        ]);
        await this.connection.sendNotification(ExitNotification.type.method);
      } catch {
        // 超时或 error — 跳过优雅关闭
      }
      try { this.connection.dispose(); } catch {}
      this.connection = null;
      this.initialized = false;
    }

    // 无论优雅关闭是否成功，强制杀进程
    if (this.process) {
      try { this.process.kill(); } catch {}
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

  /**
   * 设置 $/progress 通知回调
   */
  setProgressNotificationHandler(handler: (params: any) => void): void {
    this.progressHandler = handler;
  }
}
