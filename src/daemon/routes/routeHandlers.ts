/**
 * 路由处理器
 * 
 * 负责将所有 HTTP 请求路由到具体的处理函数
 */

import * as http from 'http';
import * as fs from 'fs';
import { daemonState, PID_FILE } from '../core/daemonStateManager';
import { parseBody, sendResponse } from '../http/requestHandlers';
import { initClient } from '../services/projectService';
import { resolvePosition } from '../services/positionResolver';
import { diagnoseProjectMismatch } from '../services/diagnostics';
import { CLIResult, InitStage, ProjectLoadState } from '../../core/types';
import { stringToSymbolKind, symbolKindToString } from '../../core/utils/symbolKind';

/**
 * 设置请求路由器
 */
export async function setupRequestRouter(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost`);
  const pathname = url.pathname;
  
  daemonState.log(`${req.method} ${pathname}`);
  
  const startTime = Date.now();
  
  try {
    // 健康检查
    if (pathname === '/health' || pathname === '/status') {
      await handleHealthCheck(res, startTime);
      return;
    }
    
    // 关闭守护进程
    if (pathname === '/shutdown') {
      await handleShutdown(res, startTime);
      return;
    }
    
    // 列出所有活跃项目（不需要 project 参数）
    if (pathname === '/projects') {
      await handleProjects(res, startTime);
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
    
    // 智能项目路径诊断
    const currentProject = daemonState.getCurrentProject();
    if (currentProject && currentProject !== project) {
      const diagnosis = diagnoseProjectMismatch(body, project);
      
      sendResponse(res, {
        success: false,
        error: `Project path mismatch: daemon initialized with '${currentProject}' but request specifies '${project}'`,
        diagnosis: diagnosis,
        suggestion: diagnosis.suggested_project 
          ? `Use --project "${diagnosis.suggested_project}" to match the daemon's project`
          : 'Ensure --project matches the daemon initialization path',
        fix_command: diagnosis.suggested_project
          ? `jls ${pathname.substring(1)} ${file || ''} --project "${diagnosis.suggested_project}"`
          : null,
        elapsed: Date.now() - startTime,
      });
      return;
    }
    
    // 初始化客户端（如果需要）
    const { client: activeClient, loadEvent } = await initClient(project, options);
    
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
      case '/definition':
        result = await handleDefinition(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;
        
      case '/references':
        result = await handleReferences(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;
        
      case '/symbols':
        result = await handleSymbols(body, activeClient, startTime);
        break;
        
      case '/implementations':
        result = await handleImplementations(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;
        
      case '/hover':
        result = await handleHover(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;
        
      case '/call-hierarchy':
        result = await handleCallHierarchy(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;
      
      case '/call-hierarchy/lazy':
      case '/call-hierarchy/snapshot':
      case '/call-hierarchy/summary':
        result = await handleEnhancedCallHierarchy(body, activeClient, project, startTime);
        break;
      
      case '/workspace-symbols':
      case '/find':
        result = await handleWorkspaceSymbols(body, activeClient, startTime);
        break;
      
      case '/type-definition':
      case '/typedef':
        result = await handleTypeDefinition(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;
      
      case '/release':
        result = await handleRelease(body, project, startTime);
        break;
        
      default:
        sendResponse(res, {
          success: false,
          error: `Unknown endpoint: ${pathname}`,
          elapsed: Date.now() - startTime,
        });
        return;
    }
    
    // 构建响应，包含项目加载状态元数据
    const response: CLIResult<any> = {
      success: true,
      data: result,
      elapsed: Date.now() - startTime,
    };
    
    // 添加项目加载状态元数据（如果有）
    if (loadEvent && (loadEvent.type === 'new' || loadEvent.type === 'reloaded')) {
      response.metadata = {
        projectStatus: {
          reloaded: loadEvent.type === 'reloaded',
          loadTime: loadEvent.loadTime,
          evictedProject: loadEvent.evictedProject,
        }
      } as any;
    }
    
    sendResponse(res, response);
    
  } catch (error: any) {
    daemonState.log('Request error:', error.message);
    sendResponse(res, {
      success: false,
      error: error.message,
      elapsed: Date.now() - startTime,
    });
  }
}

// ========== 各个端点处理函数 ==========

/**
 * 健康检查
 */
async function handleHealthCheck(res: http.ServerResponse, startTime: number) {
  const currentProject = daemonState.getCurrentProject();
  const isReady = daemonState.isClientReady();
  const initProgress = daemonState.getInitProgress();
  const lastLoadEvent = daemonState.getLastLoadEvent();
  
  // 构建项目状态
  const projectState: ProjectLoadState | undefined = currentProject ? {
    path: currentProject,
    status: isReady ? 'ready' : initProgress.stage === 'error' ? 'error' : 'loading',
    loadTime: lastLoadEvent?.loadTime,
    progress: isReady ? undefined : initProgress,
    lastAccess: Date.now(),
    priority: 0,
  } : undefined;

  // 确定整体状态
  let overallStatus: 'idle' | 'starting' | 'initializing' | 'indexing' | 'ready' | 'error';
  if (!currentProject) {
    overallStatus = 'idle';
  } else if (isReady) {
    overallStatus = 'ready';
  } else if (initProgress.stage === 'error') {
    overallStatus = 'error';
  } else {
    // 映射阶段到整体状态
    const stageMap: Record<InitStage, typeof overallStatus> = {
      'idle': 'idle',
      'starting': 'starting',
      'jdt-launching': 'starting',
      'initializing': 'initializing',
      'indexing': 'indexing',
      'ready': 'ready',
      'error': 'error',
    };
    overallStatus = stageMap[initProgress.stage];
  }

  sendResponse(res, {
    success: true,
    data: {
      status: overallStatus,
      progress: initProgress.stage !== 'idle' && initProgress.stage !== 'ready' ? initProgress : undefined,
      project: projectState,
      uptime: process.uptime(),
      pid: process.pid,
      version: '1.0.0',
    },
    elapsed: Date.now() - startTime,
  });
}

/**
 * 关闭守护进程
 */
async function handleShutdown(res: http.ServerResponse, startTime: number) {
  sendResponse(res, {
    success: true,
    data: { message: 'Daemon shutting down...' },
    elapsed: Date.now() - startTime,
  });
  
  setTimeout(async () => {
    daemonState.log('Shutdown requested, cleaning up...');
    const client = daemonState.getClient();
    if (client) {
      await client.stop();
    }
    // 删除 PID 文件
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    process.exit(0);
  }, 100);
}

/**
 * 列出项目
 */
async function handleProjects(res: http.ServerResponse, startTime: number) {
  const projectPool = daemonState.getProjectPool();
  const currentProject = daemonState.getCurrentProject();
  const isReady = daemonState.isClientReady();
  
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
}

/**
 * 处理 definition 请求
 */
async function handleDefinition(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置（支持符号模式）
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  const result = await activeClient.getDefinition(body.file, posResult.line, posResult.col);
  return result;
}

/**
 * 处理 references 请求
 */
async function handleReferences(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置（支持符号模式）
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  const includeDecl = body.includeDeclaration !== false;
  const refs = await activeClient.getReferences(body.file, posResult.line, posResult.col, includeDecl);
  return { references: refs, count: refs.length };
}

/**
 * 处理 symbols 请求
 */
async function handleSymbols(body: any, activeClient: any, startTime: number) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  let symbols = await activeClient.getDocumentSymbols(body.file);
  if (body.flat) {
    const flatList: any[] = [];
    function flatten(syms: any[], parent?: string) {
      for (const sym of syms) {
        flatList.push({ 
          name: sym.name, 
          kind: symbolKindToString(sym.kind), 
          detail: sym.detail, 
          range: sym.range, 
          parent 
        });
        if (sym.children) flatten(sym.children, sym.name);
      }
    }
    flatten(symbols);
    symbols = flatList;
  } else {
    // 层次化输出也需要转换 kind
    function convertKind(syms: any[]): any[] {
      return syms.map(sym => ({
        ...sym,
        kind: symbolKindToString(sym.kind),
        children: sym.children ? convertKind(sym.children) : undefined
      }));
    }
    symbols = convertKind(symbols);
  }
  return { symbols, count: body.flat ? symbols.length : undefined };
}

/**
 * 处理 implementations 请求
 */
async function handleImplementations(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置（支持符号模式）
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  const impls = await activeClient.getImplementations(body.file, posResult.line, posResult.col);
  return { implementations: impls, count: impls.length };
}

/**
 * 处理 hover 请求
 */
async function handleHover(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置（支持符号模式）
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  const result = await activeClient.getHover(body.file, posResult.line, posResult.col);
  return result;
}

/**
 * 处理 call-hierarchy 请求
 */
async function handleCallHierarchy(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置（支持符号模式）
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  const { line: posLine, col: posCol } = posResult;
  const maxDepth = body.depth || 5;
  const incoming = body.incoming || false;
  
  // 深度警告提示（不阻拦）
  if (maxDepth > 5) {
    console.warn(`⚠️  Warning: Call chain depth ${maxDepth} is large, may cause performance issues or parsing failures`);
    console.warn(`   Suggestion: Use --depth 3-5 for best results`);
  }
  
  const items = await activeClient.prepareCallHierarchy(body.file, posLine, posCol);
  if (!items || items.length === 0) {
    return { entry: null, calls: [], totalMethods: 0 };
  }
  
  const visited = new Set<string>();
  const allCalls: any[] = [];
  
  async function collectCalls(item: any, depth: number): Promise<void> {
    const key = `${item.uri}#${item.name}#${item.range?.start?.line}`;
    if (visited.has(key) || depth > maxDepth) return;
    visited.add(key);
    
    const calls = incoming
      ? await activeClient.getIncomingCalls(item)
      : await activeClient.getOutgoingCalls(item);
    
    // 防御性检查：确保calls是可迭代数组（LSP规范允许返回null）
    if (!calls || !Array.isArray(calls)) {
      return;
    }
    
    for (const call of calls) {
      const target = incoming ? call.from : call.to;
      if (!target.uri.includes('jdt://')) {
        allCalls.push({
          depth,
          caller: incoming ? target.name : item.name,
          callee: incoming ? item.name : target.name,
          location: { uri: target.uri, range: target.range },
          kind: symbolKindToString(target.kind),
        });
        await collectCalls(target, depth + 1);
      }
    }
  }
  
  await collectCalls(items[0], 0);
  return {
    entry: { name: items[0].name, kind: symbolKindToString(items[0].kind), detail: items[0].detail, uri: items[0].uri, range: items[0].range },
    calls: allCalls,
    totalMethods: visited.size,
  };
}

/**
 * 处理增强版调用链请求（lazy/snapshot/summary）
 */
async function handleEnhancedCallHierarchy(body: any, activeClient: any, project: string, startTime: number) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    return { error: 'position_resolution_failed', ...posResult };
  }
  const { line: posLine, col: posCol } = posResult;
  
  // 复用或创建EnhancedCallHierarchyService实例
  // 这样可以保持cursor缓存在多次HTTP请求之间可用
  if (!daemonState.getCallHierarchyService() || daemonState.getCallHierarchyServiceProject() !== project) {
    const { EnhancedCallHierarchyService } = await import('../../services/enhancedCallHierarchyService');
    daemonState.setCallHierarchyService(
      new EnhancedCallHierarchyService((activeClient as any).connectionManager),
      project
    );
    daemonState.log('Created new EnhancedCallHierarchyService for project:', project);
  }
  
  const query = {
    filePath: body.file,
    line: posLine,
    col: posCol,
    mode: body.mode || 'lazy',
    depth: parseInt(body.depth || '3'),
    direction: (body.incoming ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
    cursor: body.cursor,
    fetchSource: body.fetchSource ? body.fetchSource.split(',') : undefined,
    expandDepth: body.expandDepth ? body.expandDepth.split(',') : undefined,
    snapshotPath: body.snapshotPath,
    maxSummaryDepth: parseInt(body.maxSummaryDepth || '2'),
  };
  
  const callHierarchyService = daemonState.getCallHierarchyService();
  return await callHierarchyService.executeQuery(query);
}

/**
 * 处理 workspace-symbols/find 请求
 */
async function handleWorkspaceSymbols(body: any, activeClient: any, startTime: number) {
  const query = body.query || '';
  const limit = body.limit ? parseInt(body.limit) : undefined;
  const symbols = await activeClient.getWorkspaceSymbols(query, limit);
  
  // 可选：按 kind 过滤 - 支持字符串和数字两种格式
  let filtered = symbols;
  if (body.kind) {
    const kindNumber = stringToSymbolKind(body.kind);
    const kindString = body.kind.charAt(0).toUpperCase() + body.kind.slice(1).toLowerCase();
    filtered = symbols.filter((s: any) => {
      // 兼容 s.kind 是数字或字符串的情况
      if (typeof s.kind === 'number') {
        return kindNumber !== undefined && s.kind === kindNumber;
      } else {
        // s.kind 已经是字符串，直接比较
        return s.kind === kindString;
      }
    });
  }
  
  // 将 kind 统一转换为字符串用于输出
  const outputSymbols = filtered.map((s: any) => ({
    ...s,
    kind: symbolKindToString(s.kind)
  }));
  
  return { symbols: outputSymbols, count: outputSymbols.length };
}

/**
 * 处理 type-definition/typedef 请求
 */
async function handleTypeDefinition(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  // 解析位置（支持符号模式）
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  try {
    const explainEmpty = body.explainEmpty || false;
    const typeDefResult = await activeClient.getTypeDefinition(body.file, posResult.line, posResult.col, explainEmpty);
    // 确保返回统一格式
    return typeDefResult || { locations: [], count: 0 };
  } catch (error: any) {
    // 捕获错误并返回统一格式
    return { 
      locations: [], 
      count: 0, 
      error: error.message || 'Failed to get type definition' 
    };
  }
}

/**
 * 处理 release 请求
 */
async function handleRelease(body: any, project: string, startTime: number) {
  const projectPool = daemonState.getProjectPool();
  const currentProject = daemonState.getCurrentProject();
  
  // 释放指定项目
  const targetProject = body.releaseProject || project;
  if (projectPool) {
    const released = await projectPool.releaseProject(targetProject);
    return { released, project: targetProject };
  } else {
    // 单项目模式：如果是当前项目则释放
    if (currentProject === targetProject) {
      const client = daemonState.getClient();
      if (client) {
        await client.stop();
        daemonState.setClient(null);
        daemonState.setClientReady(false);
        daemonState.setCurrentProject(null);
      }
      return { released: true, project: targetProject };
    } else {
      return { released: false, project: targetProject, reason: 'Project not loaded' };
    }
  }
}
