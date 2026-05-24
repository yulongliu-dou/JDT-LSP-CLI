/**
 * HTTP 服务器管理
 * 
 * 负责创建和管理 HTTP 服务器，处理进程信号
 */

import * as http from 'http';
import * as fs from 'fs';
import { daemonState, DEFAULT_PORT, PID_FILE, LOG_FILE } from '../core/daemonStateManager';
import { setCorsHeaders } from './requestHandlers';
import { setupRequestRouter } from '../routes/routeHandlers';
import { validateProjectPath } from '../../core/utils/daemonValidation';

/**
 * 安全发送 IPC 消息，通道断开时静默忽略
 */
function safeIpcSend(msg: { type: string; data: any }): void {
  if (!process.send || !process.connected) return;
  try {
    process.send(msg);
  } catch {
    // 极端竞态下通道恰好在 send 前断开，静默忽略
  }
}

/**
 * 创建并启动 HTTP 服务器
 */
export function createHttpServer(
  port: number = DEFAULT_PORT,
  options?: { eagerInit?: boolean; projectPath?: string; jdtlsPath?: string; multiProject?: boolean }
): http.Server {
  const server = http.createServer(handleRequest);

  // 注册 error 事件监听器，防止 listen 失败时未处理错误导致进程崩溃
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ 端口 ${port} 已被占用`);
      console.error(`💡 请更换端口: jls daemon start --port <other-port>`);
      console.error(`   或停止占用进程: npx kill-port ${port}`);
    } else if (err.code === 'EACCES') {
      console.error(`❌ 无权限绑定端口 ${port}`);
      console.error(`💡 请使用 1024 以上的端口，或检查是否有其他程序占用了该端口`);
    } else if (err.code === 'EADDRNOTAVAIL') {
      console.error(`❌ 地址 127.0.0.1 不可用`);
    } else {
      console.error(`❌ HTTP 服务器启动失败: ${err.message} (${err.code || 'unknown'})`);
    }
    // 通知父进程启动失败
    safeIpcSend({
      type: 'error',
      data: {
        error: `HTTP server listen failed: ${err.message}`,
        code: err.code,
        port,
      },
    });
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', async () => {
    daemonState.log(`JDT LSP Daemon started on http://127.0.0.1:${port}`);
    daemonState.log(`PID: ${process.pid}`);
    daemonState.log(`Log file: ${LOG_FILE}`);

    // 写入 PID 文件（JSON 格式，包含端口、启动时间、版本）
    daemonState.writePidFile(port);
    daemonState.setStartTime(Date.now());

    console.log(`JDT LSP Daemon started on port ${port}`);
    console.log(`PID file: ${PID_FILE}`);
    console.log(`Log file: ${LOG_FILE}`);

    // 预初始化项目（如果启用）
    if (options?.eagerInit && options?.projectPath) {
      const projectCheck = validateProjectPath(options.projectPath);
      if (!projectCheck.valid) {
        console.error(`⚠️  Eager init skipped: ${projectCheck.error}`);
        if (projectCheck.suggestion) {
          console.error(`💡 ${projectCheck.suggestion}`);
        }
        safeIpcSend({
          type: 'error',
          data: {
            error: projectCheck.error,
            projectPath: options.projectPath,
          },
        });
      } else {
        if (projectCheck.warnings) {
          for (const w of projectCheck.warnings) {
            console.warn(`⚠️  ${w}`);
          }
        }
        await handleEagerInitialization(options, port);
      }
    }
  });

  // 优雅关闭
  setupGracefulShutdown(server);

  return server;
}

/**
 * 处理 HTTP 请求
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // 设置 CORS 头
  setCorsHeaders(res);
  
  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // 路由到具体处理器
  await setupRequestRouter(req, res);
}

/**
 * 预初始化项目
 */
async function handleEagerInitialization(
  options: { eagerInit?: boolean; projectPath?: string; jdtlsPath?: string; multiProject?: boolean },
  port: number
) {
  const { initClient } = await import('../services/projectService');
  
  daemonState.log('Eager initialization enabled, pre-warming project:', options.projectPath);
  console.log('Pre-initializing project:', options.projectPath);
  try {
    const projectPath = options.projectPath;
    if (!projectPath) {
      throw new Error('projectPath is required for eager initialization');
    }
    await initClient(projectPath, { jdtlsPath: options.jdtlsPath });
    daemonState.log('Project pre-initialized successfully');
    console.log('Project ready!');

    safeIpcSend({
      type: 'ready',
      data: {
        projectPath: options.projectPath,
        loadTime: daemonState.getLastLoadEvent()?.loadTime,
        pid: process.pid,
      },
    });
  } catch (error: any) {
    daemonState.log('Eager initialization failed:', error.message);
    console.error('Warning: Eager initialization failed:', error.message);
    console.error('Project will be initialized on first request.');

    safeIpcSend({
      type: 'error',
      data: {
        error: error.message,
        projectPath: options.projectPath,
      },
    });
  }
}

/**
 * 设置优雅关闭
 */
function setupGracefulShutdown(server: http.Server) {
  const shutdown = async (signal: string) => {
    daemonState.log(`Received ${signal}, shutting down...`);
    
    const projectPool = daemonState.getProjectPool();
    const client = daemonState.getClient();
    
    if (projectPool) {
      await projectPool.shutdown();
    } else if (client) {
      await client.stop();
    }
    
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
