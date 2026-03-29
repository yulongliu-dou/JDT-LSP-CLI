#!/usr/bin/env node
/**
 * JDT LSP Daemon - 守护进程服务器
 * 
 * 保持 JDT LS 常驻运行，通过 HTTP 接口接收请求
 * 避免每次命令都冷启动 JDT LS
 * 
 * 支持多项目模式（通过配置启用）
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JdtLsClient, loadConfig } from './jdtClient';
import { CLIOptions, CLIResult, SymbolInfo } from './types';
import { resolveSymbol, buildSymbolQuery, isSymbolMode } from './symbolResolver';
import { ProjectPool } from './projectPool';

// 守护进程配置
const DEFAULT_PORT = 9876;
const PID_FILE = path.join(os.homedir(), '.jdt-lsp-cli', 'daemon.pid');
const LOG_FILE = path.join(os.homedir(), '.jdt-lsp-cli', 'daemon.log');

// 全局状态
let projectPool: ProjectPool | null = null;
// 兼容单项目模式
let client: JdtLsClient | null = null;
let isReady = false;
let currentProject: string | null = null;

/**
 * 日志输出（写入文件）
 */
function log(message: string, ...args: any[]) {
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

/**
 * 初始化 JDT LS 客户端（支持多项目模式）
 */
async function initClient(projectPath: string, options: Partial<CLIOptions> = {}): Promise<JdtLsClient> {
  // 多项目模式：使用 ProjectPool
  if (projectPool) {
    return await projectPool.getClient(projectPath, options);
  }
  
  // 单项目模式（向后兼容）
  // 如果项目路径相同且已初始化，复用现有客户端
  if (client && isReady && currentProject === projectPath) {
    log('Reusing existing client for project:', projectPath);
    return client;
  }
  
  // 如果项目路径不同，先关闭旧客户端
  if (client && currentProject !== projectPath) {
    log('Project changed, reinitializing client...');
    await client.stop();
    client = null;
    isReady = false;
  }
  
  if (!client) {
    log('Initializing JDT LS client for project:', projectPath);
    
    // 使用固定的数据目录，便于复用索引缓存
    const dataDir = path.join(os.homedir(), '.jdt-lsp-cli', 'data', 
      Buffer.from(projectPath).toString('base64').replace(/[/+=]/g, '_').slice(0, 50));
    
    client = new JdtLsClient({
      projectPath,
      dataDir,
      timeout: options.timeout || 120000,
      verbose: options.verbose || false,
      jdtlsPath: options.jdtlsPath,
    });
    
    currentProject = projectPath;
    
    try {
      await client.start();
      isReady = true;
      log('JDT LS client ready for project:', projectPath);
    } catch (error: any) {
      log('Failed to initialize JDT LS:', error.message);
      client = null;
      throw error;
    }
  }
  
  return client;
}

/**
 * 解析请求体
 */
async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function sendResponse<T>(res: http.ServerResponse, result: CLIResult<T>) {
  res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result, null, 2));
}

/**
 * 解析符号位置（如果使用符号模式）
 */
async function resolvePosition(
  body: any,
  client: JdtLsClient
): Promise<{ line: number; col: number } | CLIResult<any>> {
  // 检查是否使用符号模式
  const symbolQuery = buildSymbolQuery({
    method: body.method,
    symbol: body.symbol,
    container: body.container,
    signature: body.signature,
    index: body.index,
    kind: body.kind,
  });
  
  if (!symbolQuery) {
    // 传统模式：使用行列参数
    if (!body.line || !body.col) {
      return {
        success: false,
        error: 'Position required: either provide line/col or use method/symbol parameter',
        elapsed: 0,
      };
    }
    
    const lineNum = parseInt(body.line);
    const colNum = parseInt(body.col);
    
    // 验证行号和列号的有效性
    if (isNaN(lineNum) || lineNum < 1) {
      return {
        success: false,
        error: `Invalid line number: ${body.line}. Line number must be a positive integer.`,
        elapsed: 0,
      };
    }
    
    if (isNaN(colNum) || colNum < 1) {
      return {
        success: false,
        error: `Invalid column number: ${body.col}. Column number must be a positive integer.`,
        elapsed: 0,
      };
    }
    
    // 检查行号是否超出文件范围
    if (body.file) {
      try {
        const fileContent = fs.readFileSync(body.file, 'utf-8');
        const lines = fileContent.split('\n');
        if (lineNum > lines.length) {
          return {
            success: false,
            error: `Line number ${lineNum} exceeds file length (${lines.length} lines).`,
            elapsed: 0,
          };
        }
        // 检查列号是否超出该行长度
        const targetLine = lines[lineNum - 1];
        if (colNum > targetLine.length + 1) {
          return {
            success: false,
            error: `Column number ${colNum} exceeds line ${lineNum} length (${targetLine.length} characters).`,
            elapsed: 0,
          };
        }
      } catch (error: any) {
        // 如果无法读取文件，继续执行
      }
    }
    
    return { line: lineNum, col: colNum };
  }
  
  // 符号模式：先获取文档符号，再解析位置
  const symbols: SymbolInfo[] = await client.getDocumentSymbols(body.file);
  const result = resolveSymbol(symbols, symbolQuery);
  
  if (!result.success) {
    return {
      success: false,
      error: result.error.message,
      data: { resolution_error: result.error },
      elapsed: 0,
    };
  }
  
  return {
    line: result.position.line,
    col: result.position.character,
  };
}

/**
 * 处理请求
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost`);
  const pathname = url.pathname;
  
  log(`${req.method} ${pathname}`);
  
  // CORS 头（用于开发调试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const startTime = Date.now();
  
  try {
    // 健康检查
    if (pathname === '/health' || pathname === '/status') {
      sendResponse(res, {
        success: true,
        data: {
          status: isReady ? 'ready' : 'initializing',
          project: currentProject,
          uptime: process.uptime(),
          pid: process.pid,
        },
        elapsed: Date.now() - startTime,
      });
      return;
    }
    
    // 关闭守护进程
    if (pathname === '/shutdown') {
      sendResponse(res, {
        success: true,
        data: { message: 'Daemon shutting down...' },
        elapsed: Date.now() - startTime,
      });
      
      setTimeout(async () => {
        log('Shutdown requested, cleaning up...');
        if (client) {
          await client.stop();
        }
        // 删除 PID 文件
        if (fs.existsSync(PID_FILE)) {
          fs.unlinkSync(PID_FILE);
        }
        process.exit(0);
      }, 100);
      return;
    }
    
    // 列出所有活跃项目（不需要 project 参数）
    if (pathname === '/projects') {
      const projects = projectPool ? projectPool.listProjects() : (currentProject ? [{
        path: currentProject,
        status: isReady ? 'ready' : 'initializing',
        lastAccess: Date.now(),
        priority: 0,
      }] : []);
      sendResponse(res, {
        success: true,
        data: { projects, count: projects.length },
        elapsed: Date.now() - startTime,
      });
      return;
    }
    
    // 解析请求体
    const body = await parseBody(req);
    const { project, file, line, col, options = {} } = body;
    
    // 验证项目路径
    if (!project) {
      sendResponse(res, {
        success: false,
        error: 'Missing required parameter: project',
        elapsed: Date.now() - startTime,
      });
      return;
    }
    
    // 初始化客户端（如果需要）
    const activeClient = await initClient(project, options);
    
    if (!activeClient) {
      sendResponse(res, {
        success: false,
        error: 'JDT LS client not ready',
        elapsed: Date.now() - startTime,
      });
      return;
    }
    
    // 路由到具体操作
    let result: any;
    
    switch (pathname) {
      case '/definition': {
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        // 解析位置（支持符号模式）
        const posResult = await resolvePosition(body, activeClient);
        if ('success' in posResult) {
          sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
          return;
        }
        result = await activeClient.getDefinition(file, posResult.line, posResult.col);
        break;
      }
        
      case '/references': {
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        // 解析位置（支持符号模式）
        const posResult = await resolvePosition(body, activeClient);
        if ('success' in posResult) {
          sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
          return;
        }
        const includeDecl = body.includeDeclaration !== false;
        const refs = await activeClient.getReferences(file, posResult.line, posResult.col, includeDecl);
        result = { references: refs, count: refs.length };
        break;
      }
        
      case '/symbols':
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        let symbols = await activeClient.getDocumentSymbols(file);
        if (body.flat) {
          const flatList: any[] = [];
          function flatten(syms: any[], parent?: string) {
            for (const sym of syms) {
              flatList.push({ name: sym.name, kind: sym.kind, detail: sym.detail, range: sym.range, parent });
              if (sym.children) flatten(sym.children, sym.name);
            }
          }
          flatten(symbols);
          symbols = flatList;
        }
        result = { symbols, count: body.flat ? symbols.length : undefined };
        break;
        
      case '/implementations': {
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        // 解析位置（支持符号模式）
        const posResult = await resolvePosition(body, activeClient);
        if ('success' in posResult) {
          sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
          return;
        }
        const impls = await activeClient.getImplementations(file, posResult.line, posResult.col);
        result = { implementations: impls, count: impls.length };
        break;
      }
        
      case '/hover': {
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        // 解析位置（支持符号模式）
        const posResult = await resolvePosition(body, activeClient);
        if ('success' in posResult) {
          sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
          return;
        }
        result = await activeClient.getHover(file, posResult.line, posResult.col);
        break;
      }
        
      case '/call-hierarchy': {
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        // 解析位置（支持符号模式）
        const posResult = await resolvePosition(body, activeClient);
        if ('success' in posResult) {
          sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
          return;
        }
        const { line: posLine, col: posCol } = posResult;
        const maxDepth = body.depth || 5;
        const incoming = body.incoming || false;
        
        const items = await activeClient.prepareCallHierarchy(file, posLine, posCol);
        if (!items || items.length === 0) {
          result = { entry: null, calls: [], totalMethods: 0 };
        } else {
          const visited = new Set<string>();
          const allCalls: any[] = [];
          
          async function collectCalls(item: any, depth: number): Promise<void> {
            const key = `${item.uri}#${item.name}#${item.range?.start?.line}`;
            if (visited.has(key) || depth > maxDepth) return;
            visited.add(key);
            
            const calls = incoming
              ? await activeClient.getIncomingCalls(item)
              : await activeClient.getOutgoingCalls(item);
            
            for (const call of calls) {
              const target = incoming ? call.from : call.to;
              if (!target.uri.includes('jdt://')) {
                allCalls.push({
                  depth,
                  caller: incoming ? target.name : item.name,
                  callee: incoming ? item.name : target.name,
                  location: { uri: target.uri, range: target.range },
                  kind: target.kind,
                });
                await collectCalls(target, depth + 1);
              }
            }
          }
          
          await collectCalls(items[0], 0);
          result = {
            entry: { name: items[0].name, kind: items[0].kind, detail: items[0].detail, uri: items[0].uri, range: items[0].range },
            calls: allCalls,
            totalMethods: visited.size,
          };
        }
        break;
      }
      
      case '/workspace-symbols':
      case '/find': {
        const query = body.query || '';
        const limit = body.limit ? parseInt(body.limit) : undefined;
        const symbols = await activeClient.getWorkspaceSymbols(query, limit);
        
        // 可选：按 kind 过滤
        let filtered = symbols;
        if (body.kind) {
          const kindFilter = body.kind.toLowerCase();
          filtered = symbols.filter((s: any) => 
            s.kind.toLowerCase() === kindFilter
          );
        }
        
        result = { symbols: filtered, count: filtered.length };
        break;
      }
      
      case '/type-definition':
      case '/typedef': {
        if (!file) {
          throw new Error('Missing parameter: file');
        }
        // 解析位置（支持符号模式）
        const posResult = await resolvePosition(body, activeClient);
        if ('success' in posResult) {
          sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
          return;
        }
        try {
          const typeDefResult = await activeClient.getTypeDefinition(file, posResult.line, posResult.col);
          // 确保返回统一格式
          result = typeDefResult || { locations: [], count: 0 };
        } catch (error: any) {
          // 捕获错误并返回统一格式
          result = { 
            locations: [], 
            count: 0, 
            error: error.message || 'Failed to get type definition' 
          };
        }
        break;
      }
      
      // /projects 端点已在上方提前处理（不需要 project 参数）
      
      case '/release': {
        // 释放指定项目
        const targetProject = body.releaseProject || project;
        if (projectPool) {
          const released = await projectPool.releaseProject(targetProject);
          result = { released, project: targetProject };
        } else {
          // 单项目模式：如果是当前项目则释放
          if (currentProject === targetProject && client) {
            await client.stop();
            client = null;
            isReady = false;
            currentProject = null;
            result = { released: true, project: targetProject };
          } else {
            result = { released: false, project: targetProject, reason: 'Project not loaded' };
          }
        }
        break;
      }
        
      default:
        sendResponse(res, {
          success: false,
          error: `Unknown endpoint: ${pathname}`,
          elapsed: Date.now() - startTime,
        });
        return;
    }
    
    sendResponse(res, {
      success: true,
      data: result,
      elapsed: Date.now() - startTime,
    });
    
  } catch (error: any) {
    log('Request error:', error.message);
    sendResponse(res, {
      success: false,
      error: error.message,
      elapsed: Date.now() - startTime,
    });
  }
}

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
    log('Multi-project mode enabled, max projects:', maxProjects);
    console.log(`Multi-project mode enabled (max ${maxProjects} projects)`);
    projectPool = new ProjectPool(config, log);
  }
  
  // 创建 HTTP 服务器
  const server = http.createServer(handleRequest);
  
  server.listen(port, '127.0.0.1', async () => {
    log(`JDT LSP Daemon started on http://127.0.0.1:${port}`);
    log(`PID: ${process.pid}`);
    log(`Log file: ${LOG_FILE}`);
    
    // 写入 PID 文件
    fs.writeFileSync(PID_FILE, process.pid.toString());
    
    console.log(`JDT LSP Daemon started on port ${port}`);
    console.log(`PID file: ${PID_FILE}`);
    console.log(`Log file: ${LOG_FILE}`);
    
    // 预初始化项目（如果启用）
    if (options?.eagerInit && options?.projectPath) {
      log('Eager initialization enabled, pre-warming project:', options.projectPath);
      console.log('Pre-initializing project:', options.projectPath);
      try {
        await initClient(options.projectPath, { jdtlsPath: options.jdtlsPath });
        log('Project pre-initialized successfully');
        console.log('Project ready!');
      } catch (error: any) {
        log('Eager initialization failed:', error.message);
        console.error('Warning: Eager initialization failed:', error.message);
        console.error('Project will be initialized on first request.');
      }
    }
  });
  
  // 优雅关闭
  process.on('SIGINT', async () => {
    log('Received SIGINT, shutting down...');
    if (projectPool) {
      await projectPool.shutdown();
    } else if (client) {
      await client.stop();
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    log('Received SIGTERM, shutting down...');
    if (projectPool) {
      await projectPool.shutdown();
    } else if (client) {
      await client.stop();
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    process.exit(0);
  });
}

/**
 * 获取守护进程状态
 */
export function getDaemonStatus(): { running: boolean; pid?: number; port: number } {
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
export function stopDaemon(): boolean {
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

// 默认端口导出
export const DAEMON_PORT = DEFAULT_PORT;
export const DAEMON_PID_FILE = PID_FILE;

// 如果直接运行此文件，启动守护进程
if (require.main === module) {
  const port = parseInt(process.env.JLS_DAEMON_PORT || String(DEFAULT_PORT));
  startDaemon(port);
}
