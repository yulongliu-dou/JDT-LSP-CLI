/**
 * 测试工具函数
 */

import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

/**
 * MyBatis-3 项目配置
 */
export const MYBATIS_PROJECT = {
  path: process.env.MYBATIS_PROJECT_PATH || 'E:\\mybatis-3-master',
  
  // 核心测试文件
  files: {
    defaultSqlSession: 'src\\main\\java\\org\\apache\\ibatis\\session\\defaults\\DefaultSqlSession.java',
    sqlSessionInterface: 'src\\main\\java\\org\\apache\\ibatis\\session\\SqlSession.java',
    executorInterface: 'src\\main\\java\\org\\apache\\ibatis\\executor\\Executor.java',
    baseExecutor: 'src\\main\\java\\org\\apache\\ibatis\\executor\\BaseExecutor.java',
    simpleExecutor: 'src\\main\\java\\org\\apache\\ibatis\\executor\\SimpleExecutor.java',
    reuseExecutor: 'src\\main\\java\\org\\apache\\ibatis\\executor\\ReuseExecutor.java',
    batchExecutor: 'src\\main\\java\\org\\apache\\ibatis\\executor\\BatchExecutor.java',
    cachingExecutor: 'src\\main\\java\\org\\apache\\ibatis\\executor\\CachingExecutor.java',
    baseBuilder: 'src\\main\\java\\org\\apache\\ibatis\\builder\\BaseBuilder.java',
    xmlMapperBuilder: 'src\\main\\java\\org\\apache\\ibatis\\builder\\xml\\XMLMapperBuilder.java',
    configuration: 'src\\main\\java\\org\\apache\\ibatis\\session\\Configuration.java',
  },

  /**
   * 获取完整文件路径
   */
  getFullPath(relativePath: string): string {
    return path.join(this.path, relativePath);
  },

  /**
   * 检查项目是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.path);
  },

  /**
   * 检查文件是否存在
   */
  fileExists(relativePath: string): boolean {
    return fs.existsSync(this.getFullPath(relativePath));
  },
};

/**
 * Daemon 管理器（方案 A - Daemon 模式）
 * 
 * 管理测试用的 JDT LS daemon 实例，实现：
 * - 测试间共享 daemon（避免重复启动）
 * - 自动健康检查
 * - 优雅关闭和清理
 */
export class DaemonManager {
  private static instance: DaemonManager | null = null;
  private daemonProcess: any = null;
  private daemonPort: number = 3100; // 使用不同的端口避免冲突
  private isRunning: boolean = false;
  private initProject: string | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): DaemonManager {
    if (!DaemonManager.instance) {
      DaemonManager.instance = new DaemonManager();
    }
    return DaemonManager.instance;
  }

  /**
   * 启动 daemon
   */
  async start(projectPath: string, options: { port?: number; debug?: boolean } = {}): Promise<void> {
    if (this.isRunning) {
      if (options.debug) {
        console.log('[Daemon] Already running, reusing...');
      }
      return;
    }

    this.daemonPort = options.port || this.daemonPort;
    this.initProject = projectPath;

    if (options.debug) {
      console.log(`[Daemon] Starting on port ${this.daemonPort}...`);
      console.log(`[Daemon] Project: ${projectPath}`);
    }

    const { spawn } = await import('child_process');
    const daemonPath = path.join(__dirname, '..', '..', 'dist', 'daemon.js');

    return new Promise((resolve, reject) => {
      this.daemonProcess = spawn('node', [
        daemonPath,
        'start',
        '--port', String(this.daemonPort),
        '--eager',
        '--init-project', projectPath,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      // 监听输出
      let output = '';
      this.daemonProcess.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
        if (options.debug) {
          process.stdout.write(`[Daemon stdout] ${data}`);
        }
      });

      this.daemonProcess.stderr?.on('data', (data: Buffer) => {
        if (options.debug) {
          process.stderr.write(`[Daemon stderr] ${data}`);
        }
      });

      // 等待 daemon 就绪
      const waitForReady = () => {
        this.checkHealth()
          .then((healthy) => {
            if (healthy) {
              this.isRunning = true;
              if (options.debug) {
                console.log(`[Daemon] Started successfully on port ${this.daemonPort}`);
              }
              resolve();
            } else {
              // 继续等待
              setTimeout(waitForReady, 1000);
            }
          })
          .catch(() => {
            setTimeout(waitForReady, 1000);
          });
      };

      // 启动后等待 2 秒开始健康检查
      setTimeout(waitForReady, 2000);

      // 超时处理
      setTimeout(() => {
        if (!this.isRunning) {
          reject(new Error(`Daemon startup timeout (port ${this.daemonPort})`));
        }
      }, 60000); // 60秒超时
    });
  }

  /**
   * 健康检查
   */
  async checkHealth(): Promise<boolean> {
    if (!this.isRunning && !this.daemonProcess) {
      return false;
    }

    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.daemonPort}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 停止 daemon
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[Daemon] Stopping...');

    // 通过 HTTP 接口停止
    return new Promise((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${this.daemonPort}/shutdown`,
        { method: 'POST' },
        (res) => {
          this.cleanup();
          resolve();
        }
      );

      req.on('error', () => {
        // 如果 HTTP 请求失败，直接清理
        this.cleanup();
        resolve();
      });

      req.setTimeout(3000, () => {
        req.destroy();
        this.cleanup();
        resolve();
      });

      req.end();
    });
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.daemonProcess) {
      try {
        // 尝试优雅关闭进程树
        if (process.platform === 'win32') {
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${this.daemonProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-this.daemonProcess.pid, 'SIGTERM');
        }
      } catch (e) {
        // 忽略错误
      }
      this.daemonProcess = null;
    }
    this.isRunning = false;
    this.initProject = null;
    console.log('[Daemon] Stopped');
  }

  /**
   * 获取 daemon 信息
   */
  getInfo(): { running: boolean; port: number; project: string | null } {
    return {
      running: this.isRunning,
      port: this.daemonPort,
      project: this.initProject,
    };
  }

  /**
   * 重置单例（用于测试隔离）
   */
  static reset(): void {
    if (DaemonManager.instance) {
      DaemonManager.instance.stop();
      DaemonManager.instance = null;
    }
  }
}

/**
 * 执行 CLI 命令
 */
export async function execCLI(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; debug?: boolean; useDaemon?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { exec } = await import('child_process');
  // __dirname 是 test/helpers，需要向上两级到项目根目录
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli.js');
  
  let cliArgs: string[];
  
  // 如果使用 daemon 模式，不添加 --no-daemon
  if (options.useDaemon) {
    cliArgs = [...args];
  } else {
    // 添加 --no-daemon 参数避免 daemon 启动消息干扰 JSON 输出
    cliArgs = ['--no-daemon', ...args];
  }
  
  const command = `node "${cliPath}" ${cliArgs.join(' ')}`;
  
  // 调试输出
  if (options.debug) {
    console.log('\n[CLI Debug] Command:', command);
    console.log('[CLI Debug] CWD:', options.cwd || MYBATIS_PROJECT.path);
    console.log('[CLI Debug] Mode:', options.useDaemon ? 'Daemon' : 'No-Daemon');
  }
  
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd: options.cwd || MYBATIS_PROJECT.path,
        env: { ...process.env, ...options.env },
        timeout: 60000,
      },
      (error, stdout, stderr) => {
        if (options.debug) {
          console.log('[CLI Debug] Stdout length:', stdout.length);
          console.log('[CLI Debug] Stdout preview:', stdout.substring(0, 200));
          console.log('[CLI Debug] Stderr:', stderr.substring(0, 200));
        }
        
        if (error && error.code === null) {
          reject(error);
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: error?.code || 0,
          });
        }
      }
    );
  });
}

/**
 * 解析 JSON 输出
 */
export function parseJSONOutput(stdout: string): any {
  try {
    // 找到 JSON 部分（可能包含日志输出）
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON found in output');
    }
    
    const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
    return JSON.parse(jsonStr);
  } catch (error) {
    throw new Error(`Failed to parse JSON output: ${error}\nOutput: ${stdout}`);
  }
}

/**
 * 等待守护进程就绪
 */
export async function waitForDaemon(port: number = 3000, timeout: number = 30000): Promise<boolean> {
  const http = await import('http');
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Status code: ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return false;
}

/**
 * 创建临时输出目录
 */
export function createTempOutputDir(prefix: string = 'test'): string {
  const tempDir = path.join(__dirname, '..', 'test-output', prefix + '-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * 清理临时目录
 */
export function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 验证调用链结果
 */
export function validateCallHierarchy(result: any, expectations: {
  entryName?: string;
  minCalls?: number;
  maxDepth?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!result.success) {
    errors.push(`Call hierarchy failed: ${result.error || 'Unknown error'}`);
    return { valid: false, errors };
  }

  const data = result.data;
  
  if (expectations.entryName && data.entry) {
    if (!data.entry.name.includes(expectations.entryName)) {
      errors.push(`Expected entry name to contain "${expectations.entryName}", but got "${data.entry.name}"`);
    }
  }
  
  if (expectations.minCalls !== undefined) {
    if (data.calls.length < expectations.minCalls) {
      errors.push(`Expected at least ${expectations.minCalls} calls, but got ${data.calls.length}`);
    }
  }
  
  if (expectations.maxDepth !== undefined) {
    const maxDepth = data.calls.length > 0 ? Math.max(...data.calls.map((c: any) => c.depth)) : 0;
    if (maxDepth > expectations.maxDepth) {
      errors.push(`Expected max depth ${expectations.maxDepth}, but got ${maxDepth}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 等待 daemon 就绪（用于 beforeAll）
 */
export async function waitForDaemonReady(
  projectPath: string,
  options: { debug?: boolean; port?: number } = {}
): Promise<void> {
  const daemon = DaemonManager.getInstance();
  await daemon.start(projectPath, { ...options, debug: options.debug });
}

/**
 * 清理 daemon（用于 afterAll）
 */
export async function cleanupDaemon(): Promise<void> {
  const daemon = DaemonManager.getInstance();
  await daemon.stop();
  DaemonManager.reset();
}

/**
 * 使用 daemon 模式执行 CLI 命令（便捷函数）
 */
export async function execCLIWithDaemon(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; debug?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return execCLI(args, { ...options, useDaemon: true });
}

