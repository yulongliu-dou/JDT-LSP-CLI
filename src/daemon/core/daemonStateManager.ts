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
import { InitProgress, InitStage, ProjectLoadState } from '../../core/types';
import { ProjectLoadEvent } from '../../projectPool';
import { PACKAGE_VERSION } from '../../core/constants';

// 守护进程配置
export const DEFAULT_PORT = 9876;
export const PID_FILE = path.join(os.homedir(), '.jdt-lsp-cli', 'daemon.pid');
export const LOG_FILE = path.join(os.homedir(), '.jdt-lsp-cli', 'daemon.log');

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

  // 初始化进度追踪
  private initProgress: InitProgress = {
    stage: 'idle',
    percent: 0,
    message: '守护进程空闲',
    elapsedMs: 0,
  };
  private initStartTime = 0;

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
    
    // 通过 IPC 通知父进程（如果是子进程模式）
    if (process.send) {
      process.send({
        type: 'progress',
        data: this.initProgress,
      });
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
  
  getInitProgress() { return this.initProgress; }
  getInitStartTime() { return this.initStartTime; }
  setInitStartTime(time: number) { this.initStartTime = time; }

  /**
   * 获取守护进程状态
   */
  getDaemonStatus(): { running: boolean; pid?: number; port: number } {
    const port = DEFAULT_PORT;
    
    if (!fs.existsSync(PID_FILE)) {
      return { running: false, port };
    }
    
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    
    try {
      process.kill(pid, 0);
      return { running: true, pid, port };
    } catch {
      // 进程不存在，清理 PID 文件
      fs.unlinkSync(PID_FILE);
      return { running: false, port };
    }
  }

  /**
   * 停止守护进程
   */
  stopDaemon(): boolean {
    if (!fs.existsSync(PID_FILE)) {
      return false;
    }
    
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    
    try {
      process.kill(pid, 'SIGTERM');
      // 等待进程退出
      setTimeout(() => {
        if (fs.existsSync(PID_FILE)) {
          fs.unlinkSync(PID_FILE);
        }
      }, 1000);
      return true;
    } catch {
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      return false;
    }
  }
}

// 导出默认实例
export const daemonState = new DaemonStateManager();
