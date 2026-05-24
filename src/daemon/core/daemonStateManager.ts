/**
 * 守护进程状态管理器
 * 
 * 管理守护进程的全局状态，包括：
 * - 项目状态（当前项目、就绪状态）
 * - 初始化进度
 * - 服务实例缓存
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { InitProgress, InitStage, ProjectLoadState, IndexProgress } from '../../core/types';
import { ProjectLoadEvent } from '../../projectPool';
import { PACKAGE_VERSION } from '../../core/constants';
import { LibraryClassLocator } from '../../libraryProvider/core/libraryClassLocator';
import { load as loadDaemonConfig } from '../../libraryProvider/daemonConfigStore';

// 守护进程配置
export const DEFAULT_PORT = 9876;

/**
 * 计算 PID 文件路径
 * 优先级: process.env.JLS_DAEMON_PID_FILE > 默认 ~/.jdt-lsp-cli/daemon.pid
 * 用于测试/多实例场景避免与用户生产 daemon 的 PID 文件冲突
 */
function resolvePidFile(): string {
  return process.env.JLS_DAEMON_PID_FILE || path.join(os.homedir(), '.jdt-lsp-cli', 'daemon.pid');
}

/**
 * 计算日志文件路径
 * 优先级: process.env.JLS_DAEMON_LOG_FILE > 默认 ~/.jdt-lsp-cli/daemon.log
 */
function resolveLogFile(): string {
  return process.env.JLS_DAEMON_LOG_FILE || path.join(os.homedir(), '.jdt-lsp-cli', 'daemon.log');
}

export const PID_FILE = resolvePidFile();
export const LOG_FILE = resolveLogFile();

/**
 * PID 文件内容结构
 */
export interface PidFileContent {
  pid: number;
  port: number;
  startTime: number;
  version: string;
}

/**
 * 守护进程状态
 */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port: number;
  startTime?: number;
  version?: string;
}

/**
 * 通过 health 端点探测指定端口是否由我们的 daemon 监听
 */
export function probeDaemonHealth(
  port: number,
  expectedPid?: number
): Promise<{ isDaemon: boolean; actualPid?: number; version?: string }> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 2000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const actualPid = json.data?.pid as number | undefined;
          const version = json.data?.version as string | undefined;
          const isDaemon = expectedPid ? actualPid === expectedPid : !!version;
          resolve({ isDaemon, actualPid, version });
        } catch {
          resolve({ isDaemon: false });
        }
      });
      res.on('error', () => resolve({ isDaemon: false }));
    });
    req.on('error', () => resolve({ isDaemon: false }));
    req.on('timeout', () => { req.destroy(); resolve({ isDaemon: false }); });
  });
}

/**
 * 守护进程状态管理器类
 */
export class DaemonStateManager {
  // 全局状态
  private projectPool: any = null;
  private client: any = null;
  private isReady = false;
  private currentProject: string | null = null;
  private lastLoadEvent: ProjectLoadEvent | undefined;
  private callHierarchyService: any = null;
  private callHierarchyServiceProject: string | null = null;

  // SP05：LibraryClassLocator 单例（跨请求复用）
  private libraryLocator?: LibraryClassLocator;
  /** 非致命警告（symlink 降级等），供 /status 端点返回 */
  public warnings: string[] = [];

  // 初始化进度追踪
  private initProgress: InitProgress = {
    stage: 'idle',
    percent: 0,
    message: '守护进程空闲',
    elapsedMs: 0,
  };
  private initStartTime = 0;
  private startTime: number = 0;

  /**
   * 更新初始化进度
   */
  updateProgress(stage: InitStage, percent: number, message: string, error?: string) {
    this.initProgress = {
      stage,
      percent,
      message,
      elapsedMs: this.initStartTime ? Date.now() - this.initStartTime : 0,
      projectPath: this.currentProject || undefined,
      error,
    };
    this.log(`[Progress] ${stage} (${percent}%): ${message}`);

    // 通过 IPC 通知父进程（如果是子进程模式且通道仍连接）
    if (process.send && process.connected) {
      try {
        process.send({
          type: 'progress',
          data: this.initProgress,
        });
      } catch {
        // 极端竞态下通道恰好在 send 前断开，静默忽略
      }
    }
  }

  /**
   * 日志输出（写入文件）
   */
  log(message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message} ${args.map(a => JSON.stringify(a)).join(' ')}\n`;
    
    // 确保目录存在
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    fs.appendFileSync(LOG_FILE, logLine);
    console.log(`[${timestamp}] ${message}`, ...args);
  }

  // Getters
  getProjectPool() { return this.projectPool; }
  setProjectPool(pool: any) { this.projectPool = pool; }
  
  getClient() { return this.client; }
  setClient(c: any) { this.client = c; }
  
  isClientReady() { return this.isReady; }
  setClientReady(ready: boolean) { this.isReady = ready; }
  
  getCurrentProject() { return this.currentProject; }
  setCurrentProject(project: string | null) { this.currentProject = project; }
  
  getLastLoadEvent() { return this.lastLoadEvent; }
  setLastLoadEvent(event: ProjectLoadEvent | undefined) { this.lastLoadEvent = event; }
  
  getCallHierarchyService() { return this.callHierarchyService; }
  setCallHierarchyService(service: any, project: string | null) { 
    this.callHierarchyService = service; 
    this.callHierarchyServiceProject = project;
  }
  getCallHierarchyServiceProject() { return this.callHierarchyServiceProject; }

  /**
   * 获取 LibraryClassLocator 单例（SP05）
   *
   * 首次调用时创建实例，后续复用。
   * 通过 daemonConfigStore 加载配置，通过 LSP client 提供 classFileContents。
   */
  getLibraryLocator(): LibraryClassLocator {
    if (!this.libraryLocator) {
      const config = loadDaemonConfig();
      this.libraryLocator = new LibraryClassLocator({
        fetcher: {
          getClassFileContents: (uri: string) => this.client.getClassFileContents(uri),
        },
        workspaceRoot: this.currentProject || undefined,
        javaHome: process.env.JAVA_HOME,
        config,
        onWarning: (msg) => {
          // 限制警告总数，防止内存泄漏
          if (this.warnings.length < 200) {
            this.warnings.push(msg);
          }
        },
      });
    }
    return this.libraryLocator;
  }

  // 索引进度追踪
  // FP5：MemoryMonitor + AutoScaler 引用（FP7 /status 端点使用）
  private memoryMonitor: any = null;
  private autoScaler: any = null;

  getMemoryMonitor() { return this.memoryMonitor; }
  setMemoryMonitor(m: any) { this.memoryMonitor = m; }
  getAutoScaler() { return this.autoScaler; }
  setAutoScaler(a: any) { this.autoScaler = a; }

  private indexProgressMap = new Map<string, IndexProgress>();

  updateIndexProgress(projectPath: string, params: { token: string; value: { kind: string; title?: string; percentage?: number; message?: string } }): void {
    const { token, value } = params;
    const tokenLower = (token || '').toLowerCase();
    const isRelevant = /build|index|import|workspace/i.test(tokenLower);
    if (!isRelevant) return;

    const existing = this.indexProgressMap.get(projectPath);
    const now = Date.now();

    if (value.kind === 'begin') {
      this.indexProgressMap.set(projectPath, {
        stage: 'in_progress',
        title: value.title,
        percent: value.percentage ?? 0,
        message: value.message,
        lastUpdated: now,
      });
    } else if (value.kind === 'report') {
      this.indexProgressMap.set(projectPath, {
        stage: 'in_progress',
        title: value.title ?? existing?.title,
        percent: value.percentage ?? existing?.percent ?? 0,
        message: value.message ?? existing?.message,
        lastUpdated: now,
      });
    } else if (value.kind === 'end') {
      this.indexProgressMap.set(projectPath, {
        stage: 'completed',
        title: value.title ?? existing?.title,
        percent: 100,
        message: value.message ?? existing?.message,
        lastUpdated: now,
      });
    }
  }

  getIndexProgress(projectPath: string): IndexProgress | undefined {
    return this.indexProgressMap.get(projectPath);
  }

  /**
   * 检测索引 stalled：in_progress + 10 分钟无更新 → stalled
   */
  checkStalled(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000;
    for (const [projectPath, progress] of this.indexProgressMap) {
      if (progress.stage === 'in_progress' && now - progress.lastUpdated > staleThreshold) {
        this.indexProgressMap.set(projectPath, {
          ...progress,
          stage: 'stalled',
          lastUpdated: now,
        });
        this.log(`Index progress stalled for project: ${projectPath}`);
      }
    }
  }

  getInitProgress() { return this.initProgress; }
  getInitStartTime() { return this.initStartTime; }
  setInitStartTime(time: number) { this.initStartTime = time; }
  getStartTime() { return this.startTime; }
  setStartTime(time: number) { this.startTime = time; }

  /**
   * 读取 PID 文件（兼容旧格式纯数字）
   */
  readPidFile(): PidFileContent | null {
    if (!fs.existsSync(PID_FILE)) {
      return null;
    }
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.pid === 'number' && typeof parsed.port === 'number') {
        return parsed as PidFileContent;
      }
    } catch {
      // 旧格式：纯数字
      const pid = parseInt(content, 10);
      if (!isNaN(pid)) {
        return { pid, port: DEFAULT_PORT, startTime: 0, version: 'unknown' };
      }
    }
    return null;
  }

  /**
   * 写入 JSON 格式 PID 文件
   */
  writePidFile(port: number): void {
    const content: PidFileContent = {
      pid: process.pid,
      port,
      startTime: Date.now(),
      version: PACKAGE_VERSION,
    };
    const pidDir = path.dirname(PID_FILE);
    if (!fs.existsSync(pidDir)) {
      fs.mkdirSync(pidDir, { recursive: true });
    }
    fs.writeFileSync(PID_FILE, JSON.stringify(content, null, 2));
  }

  /**
   * 获取守护进程状态
   */
  getDaemonStatus(): DaemonStatus {
    const pidInfo = this.readPidFile();
    if (!pidInfo) {
      return { running: false, port: DEFAULT_PORT };
    }
    
    try {
      process.kill(pidInfo.pid, 0);
      return {
        running: true,
        pid: pidInfo.pid,
        port: pidInfo.port || DEFAULT_PORT,
        startTime: pidInfo.startTime,
        version: pidInfo.version,
      };
    } catch (err: any) {
      if (err.code === 'EPERM') {
        // Windows 上进程存在但无权限访问，保守认为仍在运行
        return {
          running: true,
          pid: pidInfo.pid,
          port: pidInfo.port || DEFAULT_PORT,
          startTime: pidInfo.startTime,
          version: pidInfo.version,
        };
      }
      // ESRCH: 进程不存在，清理残留 PID 文件
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      return { running: false, port: DEFAULT_PORT };
    }
  }

  /**
   * 停止守护进程
   */
  stopDaemon(): boolean {
    const pidInfo = this.readPidFile();
    if (!pidInfo) {
      return false;
    }
    
    try {
      process.kill(pidInfo.pid, 'SIGTERM');
      // 轮询等待进程退出，最多 5 秒
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          process.kill(pidInfo.pid, 0);
          // 还活着
          if (Date.now() - start > 5000) {
            clearInterval(timer);
            // 超时，强制 kill
            try {
              process.kill(pidInfo.pid, 'SIGKILL');
            } catch {
              // ignore
            }
            if (fs.existsSync(PID_FILE)) {
              fs.unlinkSync(PID_FILE);
            }
          }
        } catch {
          // 已退出
          clearInterval(timer);
          if (fs.existsSync(PID_FILE)) {
            fs.unlinkSync(PID_FILE);
          }
        }
      }, 200);
      return true;
    } catch (err: any) {
      if (err.code === 'EPERM') {
        // 有进程但无权限，不删 PID 文件
        return false;
      }
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      return false;
    }
  }
}

// 导出默认实例
export const daemonState = new DaemonStateManager();
