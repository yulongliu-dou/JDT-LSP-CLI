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
 * - 自动健康检查（判项目真正就绪而非仅 HTTP 就绪）
 * - 优雅关闭和清理
 * - 测试隔离 PID 文件路径，避免与用户生产 daemon 冲突
 */
export class DaemonManager {
  private static instance: DaemonManager | null = null;
  private daemonProcess: any = null;
  private daemonPort: number = 3100; // 使用不同的端口避免冲突
  private isRunning: boolean = false;
  private initProject: string | null = null;
  private cleanedUp: boolean = false;
  private stopPromise: Promise<void> | null = null;
  private pidFilePath: string = path.join(
    __dirname, '..', 'test-output', `daemon-test-${process.pid}.pid`
  );
  private logFilePath: string = path.join(
    __dirname, '..', 'test-output', `daemon-test-${process.pid}.log`
  );

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
   * 获取当前 daemon 使用的端口
   */
  getPort(): number {
    return this.daemonPort;
  }

  /**
   * 获取隔离的 PID 文件路径
   */
  getPidFilePath(): string {
    return this.pidFilePath;
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

    // 确保隔离 PID/日志目录存在
    const outDir = path.dirname(this.pidFilePath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    // 如果上次测试残留了隔离 PID 文件，先清掉避免 daemon 启动时误判为“已运行”
    if (fs.existsSync(this.pidFilePath)) {
      try { fs.unlinkSync(this.pidFilePath); } catch { /* ignore */ }
    }

    if (options.debug) {
      console.log(`[Daemon] Starting on port ${this.daemonPort}...`);
      console.log(`[Daemon] Project: ${projectPath}`);
      console.log(`[Daemon] PID file: ${this.pidFilePath}`);
    }

    const { spawn } = await import('child_process');
    const daemonPath = path.join(__dirname, '..', '..', 'dist', 'daemon.js');

    return new Promise((resolve, reject) => {
      // daemon.js 直接运行时忽略 CLI 参数，只读环境变量
      const env = {
        ...process.env,
        JLS_DAEMON_PORT: String(this.daemonPort),
        JLS_DAEMON_EAGER: 'true',
        JLS_DAEMON_PROJECT: projectPath,
        JLS_DAEMON_PID_FILE: this.pidFilePath,
        JLS_DAEMON_LOG_FILE: this.logFilePath,
      };

      this.daemonProcess = spawn('node', [daemonPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env,
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

      // 等待 daemon 真正就绪（项目初始化完成）
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

      // 超时处理（mybatis-3 等大项目索引需更长时间，此处为项目真就绪的最终超时）
      setTimeout(() => {
        if (!this.isRunning) {
          reject(new Error(`Daemon startup timeout (port ${this.daemonPort})`));
        }
      }, 180000); // 180 秒超时，为大项目索引留足余地
    });
  }

  /**
   * 健康检查
   * 
   * 解析 /health 返回的 JSON，仅当 data.status === 'ready' 时才视为真正就绪。
   * 避免 DaemonManager 在 JDT LS 尚在索引阶段时就释放测试，导致首个请求超时。
   */
  async checkHealth(): Promise<boolean> {
    if (!this.daemonProcess) {
      return false;
    }

    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.daemonPort}/health`, (res) => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            // 仅在项目真正就绪时返回 true
            resolve(parsed?.data?.status === 'ready');
          } catch {
            resolve(false);
          }
        });
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 停止 daemon
   *
   * 使用单例 Promise 防止重入；finalize 只触发一次，避免：
   * 1) HTTP 响应回调与 setTimeout(3000) 双触发 cleanup 导致日志重复;
   * 2) afterAll 已 resolve 后又触发 cleanup 导致 "Cannot log after tests are done"。
   */
  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (!this.isRunning) {
      return;
    }

    console.log('[Daemon] Stopping...');

    this.stopPromise = new Promise<void>((resolve) => {
      let finalized = false;
      let timeoutHandle: NodeJS.Timeout | null = null;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        this.cleanup();
        resolve();
      };

      const req = http.request(
        `http://127.0.0.1:${this.daemonPort}/shutdown`,
        { method: 'POST' },
        (res) => {
          // 消费 body 防止 socket 残留触发后续 error
          res.resume();
          res.on('end', finalize);
          res.on('error', finalize);
        }
      );

      req.on('error', finalize);

      timeoutHandle = setTimeout(() => {
        try { req.destroy(); } catch { /* ignore */ }
        finalize();
      }, 3000);

      req.end();
    });

    return this.stopPromise;
  }

  /**
   * 清理资源（幂等）
   *
   * 销毁子进程 stdio 管道并 unref，确保 jest 主事件循环不再被句柄持有，
   * 避免 "Jest did not exit one second after the test run has completed"。
   */
  private cleanup(): void {
    if (this.cleanedUp) {
      return;
    }
    this.cleanedUp = true;

    if (this.daemonProcess) {
      // 释放 stdio 管道句柄（jest 主进程对 daemon 子进程的引用）
      try { this.daemonProcess.stdin?.destroy(); } catch { /* ignore */ }
      try { this.daemonProcess.stdout?.destroy(); } catch { /* ignore */ }
      try { this.daemonProcess.stderr?.destroy(); } catch { /* ignore */ }

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

      // unref 让事件循环不再因子进程而保持运行
      try { this.daemonProcess.unref(); } catch { /* ignore */ }
      this.daemonProcess = null;
    }
    // 清理隔离 PID 文件（避免残留影响下次启动）
    if (fs.existsSync(this.pidFilePath)) {
      try { fs.unlinkSync(this.pidFilePath); } catch { /* ignore */ }
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
   *
   * 注意：此方法假设外层已 await stop() 完成。这里仅清空单例引用，
   * 不再二次调用 stop() 以避免与已完成的 stopPromise 重复触发。
   */
  static reset(): void {
    DaemonManager.instance = null;
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
 * 
 * 重要：通过 env 注入 JLS_DAEMON_PORT，让 CLI 子进程的 sendDaemonRequest
 * 能连到 DaemonManager 所管理的 daemon 端口（非默认 9876）。
 */
export async function execCLIWithDaemon(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; debug?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const daemon = DaemonManager.getInstance();
  return execCLI(args, {
    ...options,
    useDaemon: true,
    env: {
      ...options.env,
      JLS_DAEMON_PORT: String(daemon.getPort()),
    },
  });
}

// ============================================================
// SP06: 平台/环境检测辅助函数
// ============================================================

/**
 * 检测当前进程是否有 symlink/junction 创建权限。
 *
 * Windows 非管理员用户默认无法创建 symlink（需 SeCreateSymbolicLinkPrivilege），
 * 此时返回 true（应跳过依赖 symlink 的测试）。
 *
 * macOS / Linux 通常支持 symlink，返回 false（不跳过）。
 */
export function skipIfNoSymlinkPermission(): boolean {
  if (process.platform !== 'win32') {
    // 非 Windows 通常支持 symlink
    return false;
  }
  // Windows：尝试创建一个临时 junction 测试权限
  const testDir = path.join(__dirname, '..', 'test-output', '_symlink_test');
  const testTarget = path.join(__dirname, '..', 'test-output', '_symlink_target');
  try {
    if (!fs.existsSync(testTarget)) {
      fs.mkdirSync(testTarget, { recursive: true });
    }
    if (fs.existsSync(testDir)) {
      try { fs.rmdirSync(testDir); } catch { /* ignore */ }
    }
    // 尝试创建 junction（Windows 特有）
    fs.symlinkSync(testTarget, testDir, 'junction');
    // 成功 → 有权限
    try { fs.unlinkSync(testDir); } catch { /* ignore */ }
    try { fs.rmdirSync(testTarget, { recursive: true }); } catch { /* ignore */ }
    return false;
  } catch (err: any) {
    // EPERM 或类似错误 → 无权限
    try { fs.rmdirSync(testTarget, { recursive: true }); } catch { /* ignore */ }
    if (err.code === 'EPERM' || err.code === 'EACCES' || err.message?.includes('privilege')) {
      return true;
    }
    // 其他未知错误，保守跳过
    return true;
  }
}

/**
 * 检测 `mvn` 命令是否可用。
 * 不可用时返回 true（应跳过依赖 mvn 的测试）。
 */
export function skipIfNoMvn(): boolean {
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where mvn' : 'which mvn';
    execSync(cmd, { stdio: 'ignore', timeout: 5000 });
    return false;
  } catch {
    return true;
  }
}

/**
 * 检测 JAVA_HOME 路径。
 *
 * 优先级：
 * 1. 环境变量 JAVA_HOME
 * 2. 环境变量 JDT_LS_JAVA_HOME（JDT LS 专用）
 * 3. Windows: 常见安装路径探测
 * 4. 回退到 `java` 命令推导
 *
 * 返回绝对路径或 null。
 */
export function detectJavaHome(): string | null {
  // 1. 环境变量
  const fromEnv = process.env.JAVA_HOME || process.env.JDT_LS_JAVA_HOME;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }

  // 2. Windows 常见路径
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Java\\jdk-21',
      'C:\\Program Files\\Java\\jdk-17',
      'C:\\Program Files\\Java\\jdk-11',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.0.0-hotspot',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // 扫描 C:\Program Files\Java\
    try {
      const javaDir = 'C:\\Program Files\\Java';
      if (fs.existsSync(javaDir)) {
        const entries = fs.readdirSync(javaDir);
        const jdkDirs = entries
          .filter(e => e.startsWith('jdk') && fs.existsSync(path.join(javaDir, e, 'bin', 'java.exe')))
          .sort()
          .reverse();
        if (jdkDirs.length > 0) return path.join(javaDir, jdkDirs[0]);
      }
    } catch { /* ignore */ }
  }

  // 3. 尝试通过 `java` 命令推导（Unix）
  try {
    const { execSync } = require('child_process');
    const javaHome = execSync('java -XshowSettings:properties -version 2>&1 | grep "java.home"', { timeout: 5000 })
      .toString()
      .trim();
    const match = javaHome.match(/java\.home\s*=\s*(.+)/);
    if (match && match[1]) {
      const trimmed = match[1].trim();
      // 去除 jre 后缀（JDK 的 java.home 可能指向 jre 子目录）
      const jdkPath = trimmed.replace(/[\/]jre$/, '');
      if (fs.existsSync(jdkPath)) return jdkPath;
    }
  } catch { /* ignore */ }

  return null;
}

