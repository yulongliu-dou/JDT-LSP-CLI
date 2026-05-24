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
import * as path from 'path';
import { CLIResult, InitStage, ProjectLoadState } from '../../core/types';
import { PACKAGE_VERSION } from '../../core/constants';
import { stringToSymbolKind, symbolKindToString } from '../../core/utils/symbolKind';
import { looksLikeJdkSymbol, buildJdkHint } from '../../core/utils/jdkSymbolHint';
import { rewriteCallItem, rewriteLocation, rewriteLocations } from '../../libraryProvider/uriRewriter';
// SP05：daemon 级 cache / library / config 端点
import { cleanStale, cleanAll } from '../../libraryProvider/cache/cacheCleaner';
import { save as saveDaemonConfig, load as loadDaemonConfig } from '../../libraryProvider/daemonConfigStore';
import { collectStats } from '../../libraryProvider/cache/cacheStats';
import { setLibraryLocator } from '../../libraryProvider/uriRewriter';
import { loadConfig as loadCoreConfig } from '../../jdt/configLoader';

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

    // SP05：cache / library / config 端点（无需 project 参数，但有 body）
    if (pathname === '/cache/stats') {
      await handleCacheStats(res, startTime);
      return;
    }
    if (pathname === '/cache/clean') {
      const cleanBody = await parseBody(req);
      await handleCacheClean(cleanBody, res, startTime);
      return;
    }
    if (pathname === '/library/resolve') {
      const resolveBody = await parseBody(req);
      await handleLibraryResolve(resolveBody, res, startTime);
      return;
    }
    if (pathname === '/config') {
      const configBody = await parseBody(req);
      await handleConfig(configBody, res, startTime);
      return;
    }

    // 优雅停止指定项目（带 draining）
    if (pathname === '/stop-project') {
      const stopBody = await parseBody(req);
      await handleStopProject(stopBody, res, startTime);
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

    // 确保 Locator 已注册（首次 initClient 成功后即可设置）
    setLibraryLocator(daemonState.getLibraryLocator());

    // FP5：多项目模式下追踪活跃请求（供 AutoScaler drain 使用）
    const projectPool = daemonState.getProjectPool();
    if (projectPool) {
      projectPool.incrementRequests(project);
      // Notify AutoScaler that pool is active (resets idle timeout)
      const autoScaler = daemonState.getAutoScaler();
      if (autoScaler) autoScaler.notifyProjectActivity();
    }

    try {
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

      case '/diagnostics':
        result = await handleDiagnostics(body, activeClient, startTime);
        break;

      case '/rename':
        result = await handleRename(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/semantic-tokens':
        result = await handleSemanticTokens(body, activeClient, startTime);
        break;

      case '/inlay-hint':
        result = await handleInlayHint(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/code-action':
        result = await handleCodeAction(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/document-highlight':
        result = await handleDocumentHighlight(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/code-lens':
        result = await handleCodeLens(body, activeClient, startTime);
        break;

      case '/completion':
        result = await handleCompletion(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/signature-help':
        result = await handleSignatureHelp(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/declaration':
        result = await handleDeclaration(body, activeClient, startTime, res);
        if (result === 'handled') return;
        break;

      case '/formatting':
        result = await handleFormatting(body, activeClient, startTime);
        break;

      case '/prepare-rename':
        result = await handlePrepareRename(body, activeClient, startTime, res);
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

    // 索引完成状态
    const indexProgress = daemonState.getIndexProgress(project);
    const indexingComplete = indexProgress
      ? indexProgress.percent === 100 || indexProgress.stage === 'completed'
      : false;

    // 元数据
    const metadata: any = { indexingComplete };
    if (loadEvent && (loadEvent.type === 'new' || loadEvent.type === 'reloaded')) {
      metadata.projectStatus = {
        reloaded: loadEvent.type === 'reloaded',
        loadTime: loadEvent.loadTime,
        evictedProject: loadEvent.evictedProject,
      };
    }
    response.metadata = metadata;

    sendResponse(res, response);

    } finally {
      if (projectPool) {
        projectPool.decrementRequests(project);
      }
    }
    
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
 * 健康检查 / 完整状态（FP7：含 memory + autoScaling + projects[] + processMemory）
 */
async function handleHealthCheck(res: http.ServerResponse, startTime: number) {
  const currentProject = daemonState.getCurrentProject();
  const isReady = daemonState.isClientReady();
  const initProgress = daemonState.getInitProgress();
  const lastLoadEvent = daemonState.getLastLoadEvent();
  const projectPool = daemonState.getProjectPool();
  const memoryMonitor = daemonState.getMemoryMonitor();
  const autoScaler = daemonState.getAutoScaler();
  const config = loadDaemonConfig();

  // 构建项目状态（单项目/当前项目）
  const currentIndexProgress = currentProject ? daemonState.getIndexProgress(currentProject) : undefined;
  const projectState: any = currentProject ? {
    path: currentProject,
    status: isReady ? 'ready' : initProgress.stage === 'error' ? 'error' : 'loading',
    loadTime: lastLoadEvent?.loadTime,
    progress: isReady ? undefined : initProgress,
    lastAccess: Date.now(),
    priority: 0,
    indexProgress: currentIndexProgress || { stage: 'not_started', percent: 0 },
  } : undefined;

  // 添加当前项目的 processMemory
  if (projectState && memoryMonitor && currentProject) {
    const pid = projectPool
      ? projectPool.getProjectPid(currentProject)
      : daemonState.getClient()?.getChildPid();
    if (pid) {
      try {
        const mem = await memoryMonitor.getProcessMemory(pid, currentProject);
        projectState.processMemory = { pid: mem.pid, rssMB: mem.rssMB, timestamp: mem.timestamp };
      } catch { /* non-critical */ }
    }
  }

  // 确定整体状态
  let overallStatus: 'idle' | 'starting' | 'initializing' | 'indexing' | 'ready' | 'error';

  // 多项目模式：从项目池聚合状态
  if (projectPool && projectPool.size > 0) {
    const projectList = projectPool.listProjects();
    const hasReady = projectList.some((p: { status: string }) => p.status === 'ready');
    const hasInitializing = projectList.some((p: { status: string }) => p.status === 'initializing');
    const allError = projectList.every((p: { status: string }) => p.status === 'error');
    if (allError) {
      overallStatus = 'error';
    } else if (hasReady) {
      overallStatus = 'ready';
    } else if (hasInitializing) {
      overallStatus = 'initializing';
    } else {
      overallStatus = 'idle';
    }
  } else if (!currentProject) {
    overallStatus = 'idle';
  } else if (isReady) {
    overallStatus = 'ready';
  } else if (initProgress.stage === 'error') {
    overallStatus = 'error';
  } else {
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

  // ---- 多项目列表（含索引进度 + 进程内存） ----
  let projects: any[] | undefined;
  if (projectPool && projectPool.size > 0) {
    const projectList = projectPool.listProjects();
    projects = await Promise.all(
      projectList.map(async (p: { path: string; status: string; lastAccess: number; priority: number }) => {
        const entry: any = {
          path: p.path,
          status: p.status,
          loadTime: projectPool.getProjectLoadTime(p.path),
          lastAccess: p.lastAccess,
          priority: p.priority,
          indexProgress: daemonState.getIndexProgress(p.path) || { stage: 'not_started', percent: 0 },
        };
        // 进程内存
        if (memoryMonitor) {
          const pid = projectPool.getProjectPid(p.path);
          if (pid) {
            try {
              const mem = await memoryMonitor.getProcessMemory(pid, p.path);
              entry.processMemory = { pid: mem.pid, rssMB: mem.rssMB, timestamp: mem.timestamp };
            } catch { /* non-critical */ }
          }
        }
        return entry;
      })
    );
  }

  // ---- Memory section ----
  let memory: any = undefined;
  if (memoryMonitor) {
    const snapshot = memoryMonitor.getLatestSnapshot();
    const degraded = memoryMonitor.isDegraded();
    const stale = memoryMonitor.isSnapshotStale();

    // 推导 degraded/stale 的原因（设计 2.3.3）
    let reason: string | undefined;
    if (degraded) {
      reason = 'All memory collection methods failed';
    } else if (!snapshot) {
      reason = 'No snapshot collected yet';
    } else if (stale) {
      reason = `Snapshot expired (age: ${Math.floor((Date.now() - snapshot.timestamp) / 1000)}s)`;
    }

    memory = {
      platform: process.platform,
      pressureLevel: memoryMonitor.getPressureLevel(),
      source: snapshot?.source ?? 'none',
      snapshotAgeMs: snapshot ? Date.now() - snapshot.timestamp : undefined,
      snapshotStale: stale,
      snapshot: snapshot ? { ...snapshot } : null,
      consecutiveFailures: memoryMonitor.getConsecutiveFailures(),
      degraded,
      reason,
    };
  }

  // ---- AutoScaling section ----
  let autoScaling: any = undefined;
  if (autoScaler) {
    const decision = autoScaler.getLatestDecision();
    const coreConfig = loadCoreConfig();
    const runtimeConfig = loadDaemonConfig();
    const projectAsConfig = coreConfig.daemon?.autoScaling;
    const runtimeAsConfig = runtimeConfig.autoScaling;

    // 运行时配置（可热更新）覆盖项目级配置
    const effectiveMaxProjects =
      runtimeAsConfig?.maxProjects ?? projectAsConfig?.maxProjects ?? coreConfig.daemon?.maxProjects ?? 3;

    autoScaling = {
      enabled: autoScaler.enabled,
      degraded: decision?.degraded ?? false,
      currentProjectCount: projectPool?.size ?? (currentProject ? 1 : 0),
      capacity: decision?.capacity ?? (projectPool?.size ?? (currentProject ? 1 : 0)),
      maxProjects: effectiveMaxProjects,
      lastScaleAction: decision?.action,
      lastScaleTime: decision?.timestamp,
    };
  }

  sendResponse(res, {
    success: true,
    data: {
      status: overallStatus,
      progress: initProgress.stage !== 'idle' && initProgress.stage !== 'ready' ? initProgress : undefined,
      project: projectState,
      projects,
      memory,
      autoScaling,
      uptime: process.uptime(),
      pid: process.pid,
      version: PACKAGE_VERSION,
      startTime: daemonState.getStartTime(),
      warnings: daemonState.warnings.slice(-10),
      libraryResolveEnabled: config.libraryResolveEnabled,
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
    const projectPool = daemonState.getProjectPool();
    const client = daemonState.getClient();
    if (projectPool) {
      await projectPool.shutdown();
    } else if (client) {
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
  // SP06: 对 jdt:// URI 执行重写
  if (result) {
    if (result.uri && result.range) {
      // 单个 Location
      return await rewriteLocation(result);
    } else if (Array.isArray(result)) {
      return await rewriteLocations(result);
    }
  }
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
  // SP06: 对 jdt:// URI 执行重写
  const rewritten = await rewriteLocations(refs);
  return { references: rewritten, count: rewritten.length };
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
  // SP06: 对 jdt:// URI 执行重写
  const rewritten = await rewriteLocations(impls);
  return { implementations: rewritten, count: rewritten.length };
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
 * 处理 diagnostics 请求
 */
async function handleDiagnostics(body: any, activeClient: any, startTime: number) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  const diagnostics = await activeClient.getDiagnostics(body.file);
  return { diagnostics, count: diagnostics.length };
}

/**
 * 处理 rename 请求
 */
async function handleRename(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  if (!body.file) {
    throw new Error('Missing parameter: file');
  }
  if (!body.newName) {
    throw new Error('Missing parameter: newName');
  }
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) {
    sendResponse(res, { ...posResult, elapsed: Date.now() - startTime });
    return 'handled';
  }
  const workspaceEdit = await activeClient.getRename(body.file, posResult.line, posResult.col, body.newName);

  // 扁平化 WorkspaceEdit
  const changes: any[] = [];
  if (workspaceEdit?.changes) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes) as [string, any[]][]) {
      changes.push({ file: uri, edits: edits.map((e: any) => ({ range: e.range, newText: e.newText })) });
    }
  }
  if (workspaceEdit?.documentChanges) {
    for (const docChange of workspaceEdit.documentChanges) {
      if (docChange.textDocument && docChange.edits) {
        changes.push({
          file: docChange.textDocument.uri,
          edits: docChange.edits.map((e: any) => ({ range: e.range, newText: e.newText })),
        });
      }
    }
  }
  const totalEdits = changes.reduce((sum, c: any) => sum + c.edits.length, 0);
  return { changes, count: totalEdits };
}

// ── 批量 LSP 命令 handler ──

function decodeSemanticTokens(raw: any, legend?: { tokenTypes: string[]; tokenModifiers: string[] } | null) {
  const data = raw?.data;
  if (!data || !Array.isArray(data)) return { tokens: [], count: 0 };

  const tokenTypeNames = legend?.tokenTypes || [];
  const tokenModifierNames = legend?.tokenModifiers || [];

  const tokens: any[] = [];
  let prevLine = 0, prevChar = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i], deltaStartChar = data[i + 1], length = data[i + 2];
    const tokenType = data[i + 3], tokenModifiers = data[i + 4];
    const line = deltaLine === 0 ? prevLine : prevLine + deltaLine;
    const startChar = deltaLine === 0 ? prevChar + deltaStartChar : deltaStartChar;

    const decodedModifiers: string[] = [];
    if (tokenModifierNames.length > 0) {
      for (let bit = 0; bit < tokenModifierNames.length; bit++) {
        if (tokenModifiers & (1 << bit)) {
          decodedModifiers.push(tokenModifierNames[bit]);
        }
      }
    }

    tokens.push({
      line,
      startChar,
      length,
      tokenType: tokenTypeNames[tokenType] || tokenType,
      tokenModifiers: decodedModifiers.length > 0 ? decodedModifiers : tokenModifiers,
    });
    prevLine = line; prevChar = startChar;
  }
  return { tokens, count: tokens.length, resultId: raw.resultId };
}

async function handleSemanticTokens(body: any, activeClient: any, startTime: number) {
  if (!body.file) throw new Error('Missing parameter: file');
  const raw = await activeClient.getSemanticTokens(body.file);
  const legend = activeClient.getSemanticTokensLegend?.() || null;
  return decodeSemanticTokens(raw, legend);
}

async function handleInlayHint(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  const hints = await activeClient.getInlayHint(body.file, posResult.line, posResult.col);
  return { hints, count: Array.isArray(hints) ? hints.length : 0 };
}

async function handleCodeAction(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  const actions = await activeClient.getCodeAction(body.file, posResult.line, posResult.col);
  return { actions, count: Array.isArray(actions) ? actions.length : 0 };
}

async function handleDocumentHighlight(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  const highlights = await activeClient.getDocumentHighlight(body.file, posResult.line, posResult.col);
  return { highlights, count: Array.isArray(highlights) ? highlights.length : 0 };
}

async function handleCodeLens(body: any, activeClient: any, startTime: number) {
  if (!body.file) throw new Error('Missing parameter: file');
  const lenses = await activeClient.getCodeLens(body.file);
  return { lenses, count: Array.isArray(lenses) ? lenses.length : 0 };
}

async function handleCompletion(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  const result = await activeClient.getCompletion(body.file, posResult.line, posResult.col);
  const items = result?.items || result || [];
  return { items: Array.isArray(items) ? items : [], count: Array.isArray(items) ? items.length : 0 };
}

async function handleSignatureHelp(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  return await activeClient.getSignatureHelp(body.file, posResult.line, posResult.col);
}

// ── 第三批 LSP 命令 handler ──

async function handleDeclaration(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  const result = await activeClient.getDeclaration(body.file, posResult.line, posResult.col);
  const locations = Array.isArray(result) ? result : [];
  return { locations, count: locations.length };
}

async function handleFormatting(body: any, activeClient: any, startTime: number) {
  if (!body.file) throw new Error('Missing parameter: file');
  const edits = await activeClient.getFormatting(body.file);
  const editsArray = Array.isArray(edits) ? edits : [];
  return { edits: editsArray, count: editsArray.length };
}

async function handlePrepareRename(body: any, activeClient: any, startTime: number, res: http.ServerResponse) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, { ...posResult, elapsed: Date.now() - startTime }); return 'handled'; }
  const range = await activeClient.getPrepareRename(body.file, posResult.line, posResult.col);
  if (range && range.start && range.end) {
    return { range, valid: true };
  }
  return { valid: false, reason: 'Cannot rename at this position' };
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

  let items: any[];
  items = await activeClient.prepareCallHierarchy(body.file, posLine, posCol);
  if (!items || items.length === 0) {
    return { entry: null, calls: [], totalMethods: 0 };
  }
  
  const visited = new Set<string>();
  const allCalls: any[] = [];
  
  async function collectCalls(item: any, depth: number): Promise<void> {
    const key = `${item.uri}#${item.name}#${item.range?.start?.line}`;
    if (visited.has(key) || depth > maxDepth) return;
    visited.add(key);

    let calls: any[];
    try {
      calls = incoming
        ? await activeClient.getIncomingCalls(item)
        : await activeClient.getOutgoingCalls(item);
    } catch (e: any) {
      // JDT LS 在遍历深度调用链时可能遇到内部错误（如非 .java 编译单元），
      // 此时优雅降级：保留已收集的调用节点，不再继续此分支。
      daemonState.log(`Call hierarchy collect error at depth ${depth} (${item.name}): ${e.message}`);
      return;
    }

    // 防御性检查：确保calls是可迭代数组（LSP规范允许返回null）
    if (!calls || !Array.isArray(calls)) {
      return;
    }

    for (const call of calls) {
      // SP02：jdt:// 重写为真实 file://；未启用/失败时透传保留原 jdt:// 行为
      const target = await rewriteCallItem(incoming ? call.from : call.to);
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
  // cursor 续查模式：位置信息已在 cursor 缓存中，不需要 file/line/col
  const isCursorMode = !!body.cursor;
  
  if (!isCursorMode && !body.file) {
    throw new Error('Missing parameter: file');
  }
  
  // cursor 模式跳过位置解析
  let posLine = 0;
  let posCol = 0;
  
  if (!isCursorMode) {
    const posResult = await resolvePosition(body, activeClient);
    if ('success' in posResult) {
      return { error: 'position_resolution_failed', ...posResult };
    }
    posLine = posResult.line;
    posCol = posResult.col;
  }
  
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

  const result: any = { symbols: outputSymbols, count: outputSymbols.length };
  if (outputSymbols.length === 0 && looksLikeJdkSymbol(query, body.kind)) {
    result.hint = buildJdkHint(query, body.kind);
  }

  return result;
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
    if (!typeDefResult) return { locations: [], count: 0 };
    // SP06: 对 jdt:// URI 执行重写
    if (typeDefResult.locations && Array.isArray(typeDefResult.locations)) {
      typeDefResult.locations = await rewriteLocations(typeDefResult.locations);
    } else if (Array.isArray(typeDefResult)) {
      return await rewriteLocations(typeDefResult);
    }
    return typeDefResult;
  } catch (error: any) {
    // 捕获错误并返回统一格式
    return { 
      locations: [], 
      count: 0, 
      error: error.message || 'Failed to get type definition' 
    };
  }
}

// ========== SP05 新增端点：cache / library / config ==========

/**
 * 缓存统计
 */
async function handleCacheStats(res: http.ServerResponse, startTime: number) {
  const stats = collectStats();
  sendResponse(res, {
    success: true,
    data: {
      totalBytes: stats.totalBytes,
      buckets: stats.buckets,
      scopeCount: Object.values(stats.buckets).reduce((sum, b) => sum + b.scopeCount, 0),
      oldestAccess: Object.values(stats.buckets)
        .map(b => b.oldestAccess)
        .filter((t): t is number => t !== null)
        .reduce((min, t) => Math.min(min, t), Infinity) || null,
      latestAccess: Object.values(stats.buckets)
        .map(b => b.newestAccess)
        .filter((t): t is number => t !== null)
        .reduce((max, t) => Math.max(max, t), -Infinity) || null,
    },
    elapsed: Date.now() - startTime,
  });
}

/**
 * 缓存清理
 * body: { mode: 'stale' | 'all', ttlDays?: number }
 */
async function handleCacheClean(body: any, res: http.ServerResponse, startTime: number) {
  try {
    const mode: string = body.mode || 'stale';
    let report: { scanned: number; removed: number; removedScopes: string[] };

    if (mode === 'all') {
      report = await cleanAll();
    } else {
      const config = loadDaemonConfig();
      const ttlDays = typeof body.ttlDays === 'number' && body.ttlDays > 0
        ? body.ttlDays
        : config.cacheTtlDays;
      if (ttlDays <= 0) {
        sendResponse(res, {
          success: true,
          data: { scanned: 0, removed: 0, message: 'TTL is 0, nothing cleaned' },
          elapsed: Date.now() - startTime,
        });
        return;
      }
      report = await cleanStale(ttlDays);
    }

    sendResponse(res, {
      success: true,
      data: report,
      elapsed: Date.now() - startTime,
    });
  } catch (err: any) {
    sendResponse(res, {
      success: false,
      error: err?.message || 'cache clean failed',
      elapsed: Date.now() - startTime,
    });
  }
}

/**
 * Library 类解析
 * body: { jdtUri: string, range?: { start: { line, character }, end: { line, character } } }
 */
async function handleLibraryResolve(body: any, res: http.ServerResponse, startTime: number) {
  try {
    const jdtUri: string = body.jdtUri;
    if (!jdtUri) {
      sendResponse(res, {
        success: false,
        error: 'Missing parameter: jdtUri',
        elapsed: Date.now() - startTime,
      });
      return;
    }

    // 确保 client 已就绪（library resolve 依赖 LSP 的 classFileContents）
    if (!daemonState.isClientReady()) {
      sendResponse(res, {
        success: false,
        error: 'JDT LS client not ready. Please initialize a project first (e.g., send a /definition or /workspace-symbols request).',
        elapsed: Date.now() - startTime,
      });
      return;
    }

    // 确保 uriRewriter 已注入 locator
    setLibraryLocator(daemonState.getLibraryLocator());

    const defaultRange = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
    const range = body.range || defaultRange;

    const locator = daemonState.getLibraryLocator();
    const resolved = await locator.resolve(jdtUri, range);

    sendResponse(res, {
      success: true,
      data: resolved,
      elapsed: Date.now() - startTime,
    });
  } catch (err: any) {
    sendResponse(res, {
      success: false,
      error: err?.message || 'library resolve failed',
      elapsed: Date.now() - startTime,
    });
  }
}

/**
 * 将点号分隔的 key 路径展开为嵌套对象。
 * 例如 "autoScaling.enabled" → { autoScaling: { enabled: value } }
 */
function buildNestedConfig(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  if (parts.length === 1) {
    return { [key]: value };
  }
  const result: Record<string, unknown> = {};
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return result;
}

/**
 * 配置热更新
 * body: { key: string, value: unknown }
 *
 * 写入 daemon-config.json 并刷新内部 ConfigStore 缓存。
 */
async function handleConfig(body: any, res: http.ServerResponse, startTime: number) {
  try {
    const key: string = body.key;
    const value: unknown = body.value;

    if (!key) {
      sendResponse(res, {
        success: false,
        error: 'Missing parameter: key',
        elapsed: Date.now() - startTime,
      });
      return;
    }

    // 支持点号分隔的嵌套路径，如 "autoScaling.enabled" → { autoScaling: { enabled: value } }
    const partial = buildNestedConfig(key, value);
    const updated = saveDaemonConfig(partial as any);

    // 刷新 uriRewriter 内部配置缓存
    const { refreshRewriterConfig } = await import('../../libraryProvider/uriRewriter');
    refreshRewriterConfig();

    sendResponse(res, {
      success: true,
      data: { key, value, updated },
      elapsed: Date.now() - startTime,
    });
  } catch (err: any) {
    sendResponse(res, {
      success: false,
      error: err?.message || 'config update failed',
      elapsed: Date.now() - startTime,
    });
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
    // 单项目模式：如果是当前项目则释放（Windows 大小写不敏感）
    const normalizedTarget = process.platform === 'win32'
      ? path.resolve(targetProject).toLowerCase()
      : path.resolve(targetProject);
    if (currentProject === normalizedTarget) {
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

/**
 * 等待项目 draining 完成（活跃请求归零或超时）
 */
async function waitForDrain(
  pool: { getActiveRequestCount(path: string): number },
  projectPath: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = pool.getActiveRequestCount(projectPath);
    if (active <= 0) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

/**
 * 优雅停止指定项目（G3：POST /stop-project）
 *
 * 与 release 的区别：默认等待活跃请求完成（draining），
 * --force 跳过 draining 直接终止。
 */
async function handleStopProject(body: any, res: http.ServerResponse, startTime: number) {
  const targetProject = body.project;
  const force = body.force === true;

  if (!targetProject) {
    sendResponse(res, {
      success: false,
      error: 'Missing required parameter: project',
      elapsed: Date.now() - startTime,
    });
    return;
  }

  const projectPool = daemonState.getProjectPool();
  if (!projectPool) {
    sendResponse(res, {
      success: false,
      error: 'Not in multi-project mode',
      elapsed: Date.now() - startTime,
    });
    return;
  }

  if (!projectPool.hasProject(targetProject)) {
    sendResponse(res, {
      success: false,
      error: `Project not loaded: ${targetProject}`,
      elapsed: Date.now() - startTime,
    });
    return;
  }

  if (!force) {
    projectPool.markDraining(targetProject);
    const drained = await waitForDrain(projectPool, targetProject, 5000);
    if (!drained) {
      projectPool.unmarkDraining(targetProject);
      sendResponse(res, {
        success: false,
        error: 'Drain timeout. Use --force to skip drain.',
        elapsed: Date.now() - startTime,
      });
      return;
    }
  }

  const released = await projectPool.releaseProject(targetProject);
  sendResponse(res, {
    success: true,
    data: { released, project: targetProject },
    elapsed: Date.now() - startTime,
  });
}
