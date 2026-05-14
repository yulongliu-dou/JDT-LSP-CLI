#!/usr/bin/env node
/**
 * JDT LSP Daemon - 守护进程服务器
 * 
 * 保持 JDT LS 常驻运行，通过 HTTP 接口接收请求
 * 避免每次命令都冷启动 JDT LS
 * 
 * 支持多项目模式（通过配置启用）
 * 
 * 重构说明：
 * 本文件已重构为模块化架构，原有功能已迁移到以下模块：
 * - src/daemon/core/daemonStateManager.ts - 状态管理
 * - src/daemon/http/httpServer.ts - HTTP 服务器
 * - src/daemon/http/requestHandlers.ts - 请求处理工具
 * - src/daemon/services/projectService.ts - 项目管理
 * - src/daemon/services/positionResolver.ts - 位置解析
 * - src/daemon/services/diagnostics.ts - 诊断服务
 * - src/daemon/routes/routeHandlers.ts - 路由处理
 * 
 * 本文件现在作为入口点，提供向后兼容的 API
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './jdtClient';
import { daemonState, DEFAULT_PORT, PID_FILE, LOG_FILE, probeDaemonHealth, DaemonStatus } from './daemon/core/daemonStateManager';
import { createHttpServer } from './daemon/http/httpServer';
import { ProjectPool } from './projectPool';
import { MemoryMonitor } from './daemon/core/memoryMonitor';
import { AutoScaler } from './daemon/services/autoScaler';
// SP05：定时清理
import { cleanStale } from './libraryProvider/cache/cacheCleaner';
import { load as loadDaemonConfig } from './libraryProvider/daemonConfigStore';
import { validateEnvironment, isPortAvailable, validatePort } from './core/utils/daemonValidation';

/**
 * 将日期格式化为统一的 ISO-like 字符串：YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 启动守护进程
 */
export async function startDaemon(port: number = DEFAULT_PORT, options?: { eagerInit?: boolean; projectPath?: string; jdtlsPath?: string; multiProject?: boolean }): Promise<void> {
  // 第2层：环境预检（JAVA_HOME、目录权限、内存）
  const envCheck = validateEnvironment(PID_FILE, LOG_FILE);
  if (!envCheck.valid) {
    console.error(`❌ 环境检查失败: ${envCheck.error}`);
    if (envCheck.suggestion) {
      console.error(`💡 ${envCheck.suggestion}`);
    }
    if (envCheck.warnings) {
      for (const w of envCheck.warnings) {
        console.warn(`⚠️  ${w}`);
      }
    }
    process.exit(1);
  }
  if (envCheck.warnings) {
    for (const w of envCheck.warnings) {
      console.warn(`⚠️  ${w}`);
    }
  }

  // 端口占用检测
  const portAvailable = await isPortAvailable(port);
  if (!portAvailable) {
    console.error(`❌ 端口 ${port} 已被占用`);
    console.error(`💡 请更换端口: jls daemon start --port <other-port>`);
    process.exit(1);
  }

  // 加载配置
  const config = loadConfig();

  // 确保目录存在
  const pidDir = path.dirname(PID_FILE);
  if (!fs.existsSync(pidDir)) {
    fs.mkdirSync(pidDir, { recursive: true });
  }

  // 检查是否已有守护进程运行（强化版：防 PID 复用、防端口冲突）
  const pidInfo = daemonState.readPidFile();
  if (pidInfo) {
    try {
      process.kill(pidInfo.pid, 0); // 检查进程是否存在
      // 进程存活，进一步验证是否是真正的 daemon（防止 PID 复用）
      const probe = await probeDaemonHealth(pidInfo.port || DEFAULT_PORT, pidInfo.pid);
      if (probe.isDaemon) {
        console.error(`❌ Daemon already running with PID ${pidInfo.pid} on port ${pidInfo.port || DEFAULT_PORT}`);
        console.error(`💡 Version: ${probe.version || pidInfo.version || 'unknown'}`);
        if (pidInfo.startTime) {
          console.error(`   Started: ${formatDateTime(new Date(pidInfo.startTime))}`);
        }
        console.error(`   Use 'jls daemon status' to see details, or 'jls daemon stop' first.`);
        process.exit(1);
      } else {
        // PID 存活但不是 daemon（PID 复用），或 health check 失败
        console.warn(`⚠️  Stale PID file detected (PID ${pidInfo.pid} is alive but not a daemon). Cleaning up...`);
        if (fs.existsSync(PID_FILE)) {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch (err: any) {
      if (err.code === 'EPERM') {
        // Windows 上进程存在但无权限
        console.error(`❌ PID ${pidInfo.pid} is active but cannot be accessed (permission denied).`);
        console.error(`💡 If this is not the daemon, remove ${PID_FILE} manually.`);
        process.exit(1);
      }
      // ESRCH: 进程不存在，清理旧 PID 文件
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
    }
  }

  // 初始化项目池（如果启用多项目模式）
  const maxProjects = config.daemon?.maxProjects || 1;
  if (maxProjects > 1 || options?.multiProject) {
    daemonState.log('Multi-project mode enabled, max projects:', maxProjects);
    console.log(`Multi-project mode enabled (max ${maxProjects} projects)`);
    const projectPool = new ProjectPool(config, daemonState.log.bind(daemonState), (projectPath, params) => {
      daemonState.updateIndexProgress(projectPath, params);
    });
    daemonState.setProjectPool(projectPool);

    // FP5：初始化 MemoryMonitor + AutoScaler（仅多项目模式）
    const asConfig = config.daemon?.autoScaling;
    if (asConfig?.enabled !== false) {
      const memoryMonitor = new MemoryMonitor(
        asConfig?.maxSnapshotAgeMs ?? 60000,
        asConfig?.collectionTimeoutMs ?? 10000,
      );
      memoryMonitor.start((asConfig?.checkIntervalSeconds ?? 15) * 1000);
      daemonState.log('MemoryMonitor started');

      const autoScaler = new AutoScaler(memoryMonitor, projectPool, config, daemonState.log.bind(daemonState));
      autoScaler.start((asConfig?.checkIntervalSeconds ?? 15) * 1000);
      daemonState.log('AutoScaler started');

      // 存储引用供 /status 端点使用（FP7）
      daemonState.setMemoryMonitor(memoryMonitor);
      daemonState.setAutoScaler(autoScaler);
    }
  }

  // 创建并启动 HTTP 服务器
  createHttpServer(port, options);

  // SP05：启动缓存定时清理（30s 后首次，之后每 12h）
  scheduleCacheCleanup();
}

/**
 * 获取守护进程状态
 */
export function getDaemonStatus(): DaemonStatus {
  return daemonState.getDaemonStatus();
}

/**
 * 停止守护进程
 */
export function stopDaemon(): boolean {
  return daemonState.stopDaemon();
}

// 默认端口导出
export const DAEMON_PORT = DEFAULT_PORT;
export const DAEMON_PID_FILE = PID_FILE;

/**
 * SP05：缓存定时清理
 *
 * daemon 启动 30s 后执行首次清理，之后每 12h 重复。
 * cacheTtlDays=0 时 cleanStale 内部直接返回。
 */
function scheduleCacheCleanup(): void {
  setTimeout(() => {
    const run = async () => {
      try {
        const config = loadDaemonConfig();
        if (config.cacheTtlDays > 0) {
          const report = await cleanStale(config.cacheTtlDays);
          if (report.removed > 0) {
            daemonState.log(`Cache cleanup: removed ${report.removed} stale scope(s) of ${report.scanned} scanned`);
          }
        }
      } catch (e: any) {
        daemonState.log(`Cache cleanup error: ${e?.message || e}`);
      }
    };

    run().catch(() => {});

    // 每 12h 再跑一次
    setInterval(() => {
      run().catch(() => {});
    }, 12 * 60 * 60 * 1000);
  }, 30_000);
}

// 如果直接运行此文件，启动守护进程
if (require.main === module) {
  const portStr = process.env.JLS_DAEMON_PORT || String(DEFAULT_PORT);
  const portCheck = validatePort(portStr);
  if (!portCheck.valid) {
    console.error(`❌ 守护进程启动失败: ${portCheck.error}`);
    if (portCheck.suggestion) {
      console.error(`💡 ${portCheck.suggestion}`);
    }
    process.exit(1);
  }
  const port = parseInt(portStr, 10);
  const eagerInit = process.env.JLS_DAEMON_EAGER === 'true';
  const projectPath = process.env.JLS_DAEMON_PROJECT || undefined;
  const jdtlsPath = process.env.JLS_DAEMON_JDTLS || undefined;
  startDaemon(port, { eagerInit, projectPath, jdtlsPath }).catch((err) => {
    console.error('❌ 守护进程启动异常:', err.message || err);
    process.exit(1);
  });
}
