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

/**
 * 创建并启动 HTTP 服务器
 */
export function createHttpServer(
  port: number = DEFAULT_PORT,
  options?: { eagerInit?: boolean; projectPath?: string; jdtlsPath?: string; multiProject?: boolean }
): http.Server {
  // 创建 HTTP 服务器
  const server = http.createServer(handleRequest);
  
  server.listen(port, '127.0.0.1', async () => {
    daemonState.log(`JDT LSP Daemon started on http://127.0.0.1:${port}`);
    daemonState.log(`PID: ${process.pid}`);
    daemonState.log(`Log file: ${LOG_FILE}`);
    
    // 写入 PID 文件
    fs.writeFileSync(PID_FILE, process.pid.toString());
    
    console.log(`JDT LSP Daemon started on port ${port}`);
    console.log(`PID file: ${PID_FILE}`);
    console.log(`Log file: ${LOG_FILE}`);
    
    // 预初始化项目（如果启用）
    if (options?.eagerInit && options?.projectPath) {
      await handleEagerInitialization(options, port);
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
    await initClient(options.projectPath!, { jdtlsPath: options.jdtlsPath });
    daemonState.log('Project pre-initialized successfully');
    console.log('Project ready!');
    
    // 通过 IPC 通知父进程初始化完成
    if (process.send) {
      process.send({
        type: 'ready',
        data: {
          projectPath: options.projectPath,
          loadTime: daemonState.getLastLoadEvent()?.loadTime,
          pid: process.pid,
        },
      });
    }
  } catch (error: any) {
    daemonState.log('Eager initialization failed:', error.message);
    console.error('Warning: Eager initialization failed:', error.message);
    console.error('Project will be initialized on first request.');
    
    // 通过 IPC 通知父进程初始化失败
    if (process.send) {
      process.send({
        type: 'error',
        data: {
          error: error.message,
          projectPath: options.projectPath,
        },
      });
    }
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
