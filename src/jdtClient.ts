/**
 * JDT Language Server Client
 * 与 eclipse.jdt.ls 通过 LSP 协议通信
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { CLIOptions, SymbolKindMap, JvmConfig, DaemonConfig } from './types';

// 配置文件路径
export const CONFIG_DIR = path.join(os.homedir(), '.jdt-lsp-cli');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 默认 JVM 配置（低内存占用 + 稳定性优化）
export const DEFAULT_JVM_CONFIG: JvmConfig = {
  xms: '256m',
  xmx: '2g',
  useG1GC: true,
  maxGCPauseMillis: 200,
  useStringDeduplication: true,
  softRefLRUPolicyMSPerMB: 50,
  extraArgs: [],
};

/**
 * 加载用户配置文件
 */
export function loadConfig(): DaemonConfig {
  const defaultConfig: DaemonConfig = {
    jvm: { ...DEFAULT_JVM_CONFIG },
    daemon: {
      port: 9876,
      idleTimeoutMinutes: 30,
    },
  };

  if (!fs.existsSync(CONFIG_FILE)) {
    return defaultConfig;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    // 深度合并配置
    return {
      jvm: { ...defaultConfig.jvm, ...userConfig.jvm },
      daemon: { ...defaultConfig.daemon, ...userConfig.daemon },
    };
  } catch (e) {
    console.error('Warning: Failed to parse config file, using defaults:', e);
    return defaultConfig;
  }
}

/**
 * 生成配置文件模板
 */
export function generateConfigTemplate(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const template: DaemonConfig = {
    jvm: DEFAULT_JVM_CONFIG,
    daemon: {
      port: 9876,
      idleTimeoutMinutes: 30,
    },
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf-8');
  console.log(`Config file created: ${CONFIG_FILE}`);
}

export class JdtLsClient {
  private connection: MessageConnection | null = null;
  private process: ChildProcess | null = null;
  private options: CLIOptions;
  private initialized = false;
  private openedFiles = new Set<string>();
  private javaExecutable: string = 'java';
  private jvmConfig: JvmConfig;

  constructor(options: CLIOptions, jvmConfig?: Partial<JvmConfig>) {
    this.options = {
      timeout: 60000,
      verbose: false,
      ...options,
    };
    // 合并 JVM 配置：默认值 < 配置文件 < 构造参数
    const config = loadConfig();
    this.jvmConfig = { ...config.jvm, ...jvmConfig };
  }

  /**
   * 日志输出
   */
  private log(message: string, ...args: any[]) {
    if (this.options.verbose) {
      console.error(`[JDT-CLI] ${message}`, ...args);
    }
  }

  /**
   * 构建 JVM 参数
   */
  private buildJvmArgs(): string[] {
    const args: string[] = [];
    const cfg = this.jvmConfig;

    // 内存配置
    args.push(`-Xms${cfg.xms}`);
    args.push(`-Xmx${cfg.xmx}`);

    // G1 垃圾收集器
    if (cfg.useG1GC) {
      args.push('-XX:+UseG1GC');
      args.push(`-XX:MaxGCPauseMillis=${cfg.maxGCPauseMillis}`);
      
      // 字符串去重（仅 G1GC 支持）
      if (cfg.useStringDeduplication) {
        args.push('-XX:+UseStringDeduplication');
      }
    }

    // 软引用清理策略
    if (cfg.softRefLRUPolicyMSPerMB > 0) {
      args.push(`-XX:SoftRefLRUPolicyMSPerMB=${cfg.softRefLRUPolicyMSPerMB}`);
    }

    // 额外参数
    if (cfg.extraArgs && cfg.extraArgs.length > 0) {
      args.push(...cfg.extraArgs);
    }

    return args;
  }

  /**
   * 查找 jdt.ls 的路径
   */
  private findJdtLsPath(): string {
    // 1. 使用用户指定的路径
    if (this.options.jdtlsPath && fs.existsSync(this.options.jdtlsPath)) {
      return this.options.jdtlsPath;
    }

    // 2. 检查常见的安装位置
    const possiblePaths = [
      // VS Code Red Hat Java extension
      path.join(os.homedir(), '.vscode', 'extensions'),
      path.join(os.homedir(), '.vscode-server', 'extensions'),
      // Qoder (VS Code based IDE)
      path.join(os.homedir(), '.qoder', 'extensions'),
      // 环境变量
      process.env.JDTLS_HOME,
      // 常见安装路径
      '/usr/share/java/jdtls',
      '/opt/jdtls',
    ].filter(Boolean) as string[];

    for (const basePath of possiblePaths) {
      if (!fs.existsSync(basePath)) continue;

      // 查找 redhat.java 扩展
      const dirs = fs.readdirSync(basePath);
      const javaExtDir = dirs.find(d => d.startsWith('redhat.java-'));
      if (javaExtDir) {
        const extPath = path.join(basePath, javaExtDir);
        const jdtlsPath = path.join(extPath, 'server');
        if (fs.existsSync(jdtlsPath)) {
          // 检查扩展是否自带 Java Runtime
          this.findBundledJava(extPath);
          return jdtlsPath;
        }
      }
    }

    throw new Error(
      'Cannot find eclipse.jdt.ls. Please specify --jdtls-path or install Red Hat Java extension in VS Code'
    );
  }

  /**
   * 查找扩展自带的 Java Runtime
   */
  private findBundledJava(extPath: string): void {
    const jrePath = path.join(extPath, 'jre');
    if (!fs.existsSync(jrePath)) {
      this.log('No bundled JRE found, using system Java');
      return;
    }

    // 查找 jre 目录下的 Java 版本目录
    const jreDirs = fs.readdirSync(jrePath);
    for (const jreDir of jreDirs) {
      const javaExe = path.join(jrePath, jreDir, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(javaExe)) {
        this.javaExecutable = javaExe;
        this.log('Found bundled Java:', javaExe);
        return;
      }
    }
  }

  /**
   * 查找 jdt.ls launcher jar
   */
  private findLauncherJar(jdtlsPath: string): string {
    const pluginsDir = path.join(jdtlsPath, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      throw new Error(`Plugins directory not found: ${pluginsDir}`);
    }

    const files = fs.readdirSync(pluginsDir);
    const launcher = files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
    if (!launcher) {
      throw new Error('Cannot find equinox launcher jar');
    }

    return path.join(pluginsDir, launcher);
  }

  /**
   * 获取配置目录
   */
  private getConfigDir(jdtlsPath: string): string {
    const platform = os.platform();
    let configName = 'config_linux';
    if (platform === 'win32') {
      configName = 'config_win';
    } else if (platform === 'darwin') {
      configName = 'config_mac';
    }
    return path.join(jdtlsPath, configName);
  }

  /**
   * 递归复制目录
   */
  private copyDirSync(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 启动 JDT LS
   */
  async start(): Promise<void> {
    if (this.connection) {
      return;
    }

    const jdtlsPath = this.findJdtLsPath();
    const launcherJar = this.findLauncherJar(jdtlsPath);
    const configDir = this.getConfigDir(jdtlsPath);
    const timestamp = Date.now();
    const dataDir = this.options.dataDir || path.join(os.tmpdir(), `jdt-lsp-cli-data-${timestamp}`);

    this.log('Starting JDT LS...');
    this.log('  JDT LS Path:', jdtlsPath);
    this.log('  Launcher:', launcherJar);
    this.log('  Shared Config:', configDir);
    this.log('  Data:', dataDir);
    this.log('  Project:', this.options.projectPath);
    this.log('  Java:', this.javaExecutable);

    // 确保数据目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 构建 JVM 参数
    const jvmArgs = this.buildJvmArgs();
    this.log('JVM Config:', this.jvmConfig);

    // 构建启动参数 (参考 jdtls.py)
    const javaArgs = [
      // JVM 内存与 GC 参数
      ...jvmArgs,
      // Eclipse/OSGi 参数
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dosgi.checkConfiguration=true',
      `-Dosgi.sharedConfiguration.area=${configDir}`,
      '-Dosgi.sharedConfiguration.area.readOnly=true',
      '-Dosgi.configuration.cascaded=true',
      // Java 模块系统参数
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      // Launcher
      '-jar', launcherJar,
      '-data', dataDir,
    ];

    // 启动进程
    this.process = spawn(this.javaExecutable, javaArgs, {
      cwd: this.options.projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 错误输出
    this.process.stderr?.on('data', (data) => {
      this.log('STDERR:', data.toString());
    });

    this.process.on('error', (err) => {
      console.error('Failed to start JDT LS:', err);
    });

    this.process.on('exit', (code) => {
      this.log('JDT LS exited with code:', code);
      this.connection = null;
      this.initialized = false;
    });

    // 创建 LSP 连接
    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout!),
      new StreamMessageWriter(this.process.stdin!)
    );

    this.connection.listen();

    // 初始化
    await this.initialize();
  }

  /**
   * 发送初始化请求
   */
  private async initialize(): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not established');
    }

    const initParams = {
      processId: process.pid,
      rootUri: `file://${this.options.projectPath.replace(/\\/g, '/')}`,
      rootPath: this.options.projectPath,
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
          uri: `file://${this.options.projectPath.replace(/\\/g, '/')}`,
          name: path.basename(this.options.projectPath),
        },
      ],
    };

    this.log('Sending initialize request...');
    const startTime = Date.now();

    const result: any = await this.connection.sendRequest('initialize', initParams);
    this.log('Initialize response received in', Date.now() - startTime, 'ms');
    this.log('Server capabilities:', JSON.stringify(result.capabilities, null, 2));

    // 发送 initialized 通知
    await this.connection.sendNotification('initialized', {});
    this.initialized = true;

    // 等待索引完成
    await this.waitForIndexing();
  }

  /**
   * 等待项目索引完成
   */
  private async waitForIndexing(): Promise<void> {
    this.log('Waiting for project indexing...');
    
    // 监听 JDT LS 的进度通知来判断索引是否完成
    // 但由于某些版本的 JDT LS 不发送进度通知，我们使用渐进式等待策略
    const maxWaitTime = 60000; // 最大等待 60 秒
    const checkInterval = 2000; // 每 2 秒检查一次
    const startTime = Date.now();
    
    // 设置进度处理器（如果 JDT LS 发送进度通知）
    let indexingComplete = false;
    const progressHandler = (params: any) => {
      this.log('Progress:', params);
      if (params.value?.kind === 'end') {
        indexingComplete = true;
      }
    };
    
    this.connection?.onNotification('$/progress', progressHandler);
    
    // 渐进式等待：先等待基础初始化
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 然后通过尝试一个简单操作来验证服务是否就绪
    while (Date.now() - startTime < maxWaitTime && !indexingComplete) {
      try {
        // 尝试发送一个简单请求来测试服务是否响应
        await Promise.race([
          this.connection?.sendRequest('workspace/symbol', { query: '' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        this.log('JDT LS is responding, indexing assumed ready');
        break;
      } catch (e) {
        this.log('JDT LS not ready yet, waiting...');
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }
    
    this.log('Indexing wait complete after', Date.now() - startTime, 'ms');
  }

  /**
   * 打开文件
   */
  private async openFile(filePath: string): Promise<void> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const uri = `file://${filePath.replace(/\\/g, '/')}`;
    if (this.openedFiles.has(uri)) {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    await this.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'java',
        version: 1,
        text: content,
      },
    });

    this.openedFiles.add(uri);
    // 给 LS 一点时间处理文件（减少延迟）
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * 将 1-based 行列转换为 0-based Position
   */
  private toPosition(line: number, character: number): { line: number; character: number } {
    return { line: line - 1, character: character - 1 };
  }

  /**
   * 转换 symbol kind
   */
  private toSymbolKind(kind: number): string {
    return SymbolKindMap[kind] || `Unknown(${kind})`;
  }

  /**
   * 获取调用层级入口
   */
  async prepareCallHierarchy(filePath: string, line: number, character: number): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    await this.openFile(filePath);
    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    this.log('Preparing call hierarchy at', { uri, line, character });

    const result: any = await this.connection.sendRequest('textDocument/prepareCallHierarchy', {
      textDocument: { uri },
      position: this.toPosition(line, character),
    });

    return (result || []).map((item: any) => ({
      ...item,
      kind: this.toSymbolKind(item.kind),
    }));
  }

  /**
   * 获取出向调用
   */
  async getOutgoingCalls(item: any): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    const result: any = await this.connection.sendRequest('callHierarchy/outgoingCalls', { item });
    return (result || []).map((call: any) => ({
      ...call,
      to: { ...call.to, kind: this.toSymbolKind(call.to.kind) },
    }));
  }

  /**
   * 获取入向调用
   */
  async getIncomingCalls(item: any): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    const result: any = await this.connection.sendRequest('callHierarchy/incomingCalls', { item });
    return (result || []).map((call: any) => ({
      ...call,
      from: { ...call.from, kind: this.toSymbolKind(call.from.kind) },
    }));
  }

  /**
   * 获取定义位置
   */
  async getDefinition(filePath: string, line: number, character: number): Promise<any> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    await this.openFile(filePath);
    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    const result = await this.connection.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: this.toPosition(line, character),
    });

    return result;
  }

  /**
   * 获取引用
   */
  async getReferences(filePath: string, line: number, character: number, includeDeclaration = true): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    await this.openFile(filePath);
    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    const result: any = await this.connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: this.toPosition(line, character),
      context: { includeDeclaration },
    });

    return result || [];
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(filePath: string): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    await this.openFile(filePath);
    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    const result: any = await this.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    });

    const transformSymbol = (sym: any): any => ({
      ...sym,
      kind: this.toSymbolKind(sym.kind),
      children: sym.children?.map(transformSymbol),
    });

    return (result || []).map(transformSymbol);
  }

  /**
   * 获取实现
   */
  async getImplementations(filePath: string, line: number, character: number): Promise<any[]> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    await this.openFile(filePath);
    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    const result: any = await this.connection.sendRequest('textDocument/implementation', {
      textDocument: { uri },
      position: this.toPosition(line, character),
    });

    return Array.isArray(result) ? result : result ? [result] : [];
  }

  /**
   * 获取悬停信息
   */
  async getHover(filePath: string, line: number, character: number): Promise<any> {
    if (!this.connection || !this.initialized) {
      throw new Error('Client not initialized');
    }

    await this.openFile(filePath);
    const uri = `file://${filePath.replace(/\\/g, '/')}`;

    const result = await this.connection.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: this.toPosition(line, character),
    });

    return result;
  }

  /**
   * 关闭连接
   */
  async stop(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.sendRequest('shutdown');
        await this.connection.sendNotification('exit');
      } catch (e) {
        // ignore
      }
      this.connection.dispose();
      this.connection = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.initialized = false;
    this.openedFiles.clear();
  }
}
