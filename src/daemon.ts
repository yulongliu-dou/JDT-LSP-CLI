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

/**
 * 启动守护进程
 */
export function startDaemon(port: number = DEFAULT_PORT, options?: { eagerInit?: boolean; projectPath?: string; jdtlsPath?: string; multiProject?: boolean }): void {
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

// 如果直接运行此文件，启动守护进程
if (require.main === module) {
  const port = parseInt(process.env.JLS_DAEMON_PORT || String(DEFAULT_PORT));
  startDaemon(port);
}
