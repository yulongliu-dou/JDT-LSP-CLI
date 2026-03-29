/**
 * 项目池管理器 - 支持多项目守护进程
 * 
 * 特性：
 * - LRU 淘汰策略
 * - 优先级保护
 * - 空闲超时回收
 * - 内存限制
 */

import * as path from 'path';
import * as os from 'os';
import { JdtLsClient } from './jdtClient';
import { CLIOptions, DaemonConfig, ProjectConfig } from './types';

/**
 * 项目客户端状态
 */
interface ProjectClient {
  client: JdtLsClient;
  projectPath: string;
  lastAccess: number;
  priority: number;
  status: 'initializing' | 'ready' | 'error';
  initPromise?: Promise<void>;
}

/**
 * 项目池管理器
 */
export class ProjectPool {
  private clients: Map<string, ProjectClient> = new Map();
  private config: DaemonConfig;
  private log: (message: string, ...args: any[]) => void;

  constructor(config: DaemonConfig, logger?: (message: string, ...args: any[]) => void) {
    this.config = config;
    this.log = logger || console.log;
  }

  /**
   * 获取项目客户端（如果不存在则创建）
   */
  async getClient(projectPath: string, options: Partial<CLIOptions> = {}): Promise<JdtLsClient> {
    const normalizedPath = path.resolve(projectPath);
    
    // 检查现有客户端
    const existing = this.clients.get(normalizedPath);
    if (existing) {
      existing.lastAccess = Date.now();
      
      // 等待初始化完成
      if (existing.status === 'initializing' && existing.initPromise) {
        await existing.initPromise;
      }
      
      if (existing.status === 'ready') {
        this.log('Reusing existing client for project:', normalizedPath);
        return existing.client;
      }
      
      // 如果状态是 error，移除并重新创建
      if (existing.status === 'error') {
        await this.releaseProject(normalizedPath);
      }
    }
    
    // 检查容量，必要时淘汰
    const maxProjects = this.config.daemon?.maxProjects || 1;
    if (this.clients.size >= maxProjects) {
      await this.evictLRU();
    }
    
    // 创建新客户端
    return await this.createClient(normalizedPath, options);
  }

  /**
   * 创建新的项目客户端
   */
  private async createClient(projectPath: string, options: Partial<CLIOptions> = {}): Promise<JdtLsClient> {
    this.log('Creating new client for project:', projectPath);
    
    // 获取项目配置
    const projectConfig = this.config.projects?.[projectPath];
    const priority = projectConfig?.priority || 0;
    
    // 构建数据目录
    const dataDir = path.join(os.homedir(), '.jdt-lsp-cli', 'data', 
      Buffer.from(projectPath).toString('base64').replace(/[/+=]/g, '_').slice(0, 50));
    
    // 合并 JVM 配置
    const jvmConfig = {
      ...this.config.jvm,
      ...projectConfig?.jvmConfig,
    };
    
    // 如果配置了每项目内存限制，覆盖 xmx
    if (this.config.daemon?.perProjectMemory) {
      jvmConfig.xmx = this.config.daemon.perProjectMemory;
    }
    
    const client = new JdtLsClient({
      projectPath,
      dataDir,
      timeout: options.timeout || 120000,
      verbose: options.verbose || false,
      jdtlsPath: options.jdtlsPath,
    }, jvmConfig);
    
    const projectClient: ProjectClient = {
      client,
      projectPath,
      lastAccess: Date.now(),
      priority,
      status: 'initializing',
    };
    
    // 设置初始化 Promise
    projectClient.initPromise = (async () => {
      try {
        await client.start();
        projectClient.status = 'ready';
        this.log('Client ready for project:', projectPath);
      } catch (error: any) {
        projectClient.status = 'error';
        this.log('Failed to initialize client for project:', projectPath, error.message);
        throw error;
      }
    })();
    
    this.clients.set(projectPath, projectClient);
    
    await projectClient.initPromise;
    return client;
  }

  /**
   * 淘汰最近最少使用的项目（LRU）
   */
  private async evictLRU(): Promise<void> {
    if (this.clients.size === 0) return;
    
    // 找到优先级最低、最久未使用的项目
    let candidate: ProjectClient | null = null;
    let candidatePath: string | null = null;
    
    for (const [path, pc] of this.clients) {
      if (!candidate) {
        candidate = pc;
        candidatePath = path;
        continue;
      }
      
      // 优先级低的优先淘汰
      if (pc.priority < candidate.priority) {
        candidate = pc;
        candidatePath = path;
      } else if (pc.priority === candidate.priority) {
        // 同优先级，淘汰最久未访问的
        if (pc.lastAccess < candidate.lastAccess) {
          candidate = pc;
          candidatePath = path;
        }
      }
    }
    
    if (candidatePath) {
      this.log('Evicting project due to capacity limit:', candidatePath);
      await this.releaseProject(candidatePath);
    }
  }

  /**
   * 释放指定项目
   */
  async releaseProject(projectPath: string): Promise<boolean> {
    const normalizedPath = path.resolve(projectPath);
    const pc = this.clients.get(normalizedPath);
    
    if (!pc) {
      return false;
    }
    
    this.log('Releasing project:', normalizedPath);
    
    try {
      await pc.client.stop();
    } catch (e) {
      // ignore
    }
    
    this.clients.delete(normalizedPath);
    return true;
  }

  /**
   * 获取所有活跃项目
   */
  listProjects(): Array<{
    path: string;
    status: string;
    lastAccess: number;
    priority: number;
  }> {
    const result: Array<{
      path: string;
      status: string;
      lastAccess: number;
      priority: number;
    }> = [];
    
    for (const [path, pc] of this.clients) {
      result.push({
        path,
        status: pc.status,
        lastAccess: pc.lastAccess,
        priority: pc.priority,
      });
    }
    
    return result.sort((a, b) => b.lastAccess - a.lastAccess);
  }

  /**
   * 获取项目数量
   */
  get size(): number {
    return this.clients.size;
  }

  /**
   * 检查项目是否已加载
   */
  hasProject(projectPath: string): boolean {
    return this.clients.has(path.resolve(projectPath));
  }

  /**
   * 关闭所有客户端
   */
  async shutdown(): Promise<void> {
    this.log('Shutting down all project clients...');
    
    const promises: Promise<void>[] = [];
    for (const [, pc] of this.clients) {
      promises.push(pc.client.stop().catch(() => {}));
    }
    
    await Promise.all(promises);
    this.clients.clear();
    
    this.log('All project clients stopped');
  }
}
