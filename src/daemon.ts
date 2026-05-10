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
import { daemonState, DEFAULT_PORT, PID_FILE, LOG_FILE } from './daemon/core/daemonStateManager';
import { createHttpServer } from './daemon/http/httpServer';
import { ProjectPool } from './projectPool';
// SP05：定时清理
import { cleanStale } from './libraryProvider/cache/cacheCleaner';
import { load as loadDaemonConfig } from './libraryProvider/daemonConfigStore';
import { validateEnvironment, isPortAvailable, validatePort } from './core/utils/daemonValidation';

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

  // 检查是否已有守护进程运行
  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    try {
      process.kill(existingPid, 0); // 检查进程是否存在
      console.error(`Daemon already running with PID ${existingPid}`);
      process.exit(1);
    } catch {
      // 进程不存在，清理旧 PID 文件
      fs.unlinkSync(PID_FILE);
    }
  }

  // 初始化项目池（如果启用多项目模式）
  const maxProjects = config.daemon?.maxProjects || 1;
  if (maxProjects > 1 || options?.multiProject) {
    daemonState.log('Multi-project mode enabled, max projects:', maxProjects);
    console.log(`Multi-project mode enabled (max ${maxProjects} projects)`);
    const projectPool = new ProjectPool(config, daemonState.log.bind(daemonState));
    daemonState.setProjectPool(projectPool);
  }

  // 创建并启动 HTTP 服务器
  createHttpServer(port, options);

  // SP05：启动缓存定时清理（30s 后首次，之后每 12h）
  scheduleCacheCleanup();
}

/**
 * 获取守护进程状态
 */
export function getDaemonStatus(): { running: boolean; pid?: number; port: number } {
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
