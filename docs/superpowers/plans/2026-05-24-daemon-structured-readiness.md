# 守护进程结构化就绪模型 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入项目就绪阶段模型（connecting → indexing → ready），Maven 导入异步化不阻塞 ready，透明排队与结构化错误，多项目自动发现。

**Architecture:** 在现有 daemon 架构上引入 `ProjectPhase` 状态机。`waitForIndexing` 同步等待 workspace 索引完成后报告 ready，`waitForBuildImport` 改为异步后台执行。命令入口新增就绪检查，返回结构化错误码引导 agent。健康端点暴露每项目 phase + buildImport 进度。

**Tech Stack:** TypeScript, Node.js HTTP server, JDT LS LSP

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/core/types.ts` | 新增 `ProjectPhase` 类型；`IndexProgress.stage` 扩展为 `ProjectPhase | 'not_started' \| 'in_progress' \| 'completed' \| 'stalled'` |
| `src/daemon/core/daemonStateManager.ts` | `indexProgressMap` 每项新增 `phase` + `buildImport` 字段；新增 `updateBuildImportProgress()` / `getBuildImportProgress()` |
| `src/daemon/services/projectService.ts` | 新增 `waitForIndexing()`；`waitForBuildImport` 改为 `scheduleBuildImportAsync`；调整 `initClient()` 顺序 |
| `src/daemon/routes/routeHandlers.ts` | 新增 `POST /project-load`；命令入口增加就绪检查 + `PROJECT_NOT_LOADED` / `PROJECT_INDEXING` 结构化错误；移除多项目模式下项目不匹配拦截；增强 `/health` |
| `src/projectPool.ts` | 新增 `getStatus(projectPath)` 方法 |

---

### Task 1: 新增 ProjectPhase 类型与 IndexProgress 扩展

**Files:**
- Modify: `src/core/types.ts:444-450`

- [ ] **Step 1: 在 IndexProgress 上方新增 ProjectPhase 类型，并扩展 stage**

```typescript
// 在 line 442 (// ========== Index Progress ==========) 之后插入 ProjectPhase:

/**
 * 项目就绪阶段
 */
export type ProjectPhase = 'connecting' | 'indexing' | 'ready' | 'error';

// 修改 IndexProgress (line 444-450)，stage 扩展为联合类型:
export interface IndexProgress {
  stage: 'not_started' | 'in_progress' | 'completed' | 'stalled' | ProjectPhase;
  title?: string;
  percent?: number;
  message?: string;
  lastUpdated: number;
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/core/types.ts
git commit -m "feat: add ProjectPhase type and extend IndexProgress.stage"
```

---

### Task 2: daemonStateManager 扩展 buildImport 追踪

**Files:**
- Modify: `src/daemon/core/daemonStateManager.ts:226-286`

- [ ] **Step 1: 新增 buildImport 相关方法**

在 `checkStalled()` 方法之后（line 286 后），在 `getInitProgress()` 之前插入：

```typescript
  /**
   * 更新 build import 进度（异步后台 Maven/Gradle 导入）
   */
  updateBuildImportProgress(projectPath: string, progress: IndexProgress): void {
    const existing = this.indexProgressMap.get(projectPath);
    this.indexProgressMap.set(projectPath, {
      ...(existing || { stage: 'not_started', lastUpdated: Date.now() }),
      buildImport: progress,
    } as any);
  }

  /**
   * 获取 build import 进度
   */
  getBuildImportProgress(projectPath: string): IndexProgress | undefined {
    const entry = this.indexProgressMap.get(projectPath) as any;
    return entry?.buildImport;
  }

  /**
   * 设置项目的就绪阶段 (ProjectPhase)
   */
  setProjectPhase(projectPath: string, phase: ProjectPhase): void {
    const existing = this.indexProgressMap.get(projectPath);
    this.indexProgressMap.set(projectPath, {
      ...(existing || { stage: 'not_started', lastUpdated: Date.now() }),
      phase,
    } as any);
  }

  /**
   * 获取项目的就绪阶段
   */
  getProjectPhase(projectPath: string): ProjectPhase | undefined {
    const entry = this.indexProgressMap.get(projectPath) as any;
    return entry?.phase;
  }
```

需要在文件顶部 import `ProjectPhase` 和 `IndexProgress`：

```typescript
// 修改 line 14 的 import，确保包含 ProjectPhase 和 IndexProgress:
import { InitProgress, InitStage, ProjectLoadState, IndexProgress, ProjectPhase } from '../../core/types';
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/daemon/core/daemonStateManager.ts
git commit -m "feat: extend daemonStateManager with buildImport and phase tracking"
```

---

### Task 3: projectService — waitForIndexing + scheduleBuildImportAsync

**Files:**
- Modify: `src/daemon/services/projectService.ts:全文件`

- [ ] **Step 1: 新增 `waitForIndexing()` 函数**

在 `waitForBuildImport` 函数之后插入（line 236 之后）：

```typescript
/**
 * 等待 workspace 源文件索引完成
 *
 * JDT LS 在启动后会通过 $/progress 上报索引 job。
 * 索引未完成时 LSP 查询响应慢或结果不完整。
 * 此处轮询 daemonState.getIndexProgress() 等待索引完成。
 *
 * 无构建文件或长时间无索引进度的项目直接跳过。
 */
async function waitForIndexing(projectPath: string): Promise<void> {
  daemonState.setProjectPhase(projectPath, 'indexing');
  daemonState.updateProgress('indexing', 50, '等待 workspace 索引完成...');

  // Phase 1: 等待首次索引进度出现（30s 超时）
  const firstProgressTimeout = Date.now() + 30_000;
  let indexDetected = false;

  while (Date.now() < firstProgressTimeout) {
    const p = daemonState.getIndexProgress(projectPath);
    if (p && p.stage !== 'not_started') {
      const title = (p.title || '').toLowerCase();
      // 排除 import 类 job（由 buildImport 后台处理）
      if (!/import/i.test(title) && /build|index|workspace/i.test(title)) {
        indexDetected = true;
        break;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!indexDetected) {
    daemonState.log('未检测到索引进度，可能无构建文件或索引已完成，继续');
    daemonState.setProjectPhase(projectPath, 'ready');
    return;
  }

  // Phase 2: 等待所有索引 job 完成或 stalled（300s 超时）
  const maxWait = 300_000;
  const startWait = Date.now();

  while (Date.now() - startWait < maxWait) {
    const p = daemonState.getIndexProgress(projectPath);
    if (!p) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    if (p.stage === 'completed') {
      daemonState.updateProgress('indexing', 100, 'workspace 索引完成');
      daemonState.log('workspace 索引完成');
      daemonState.setProjectPhase(projectPath, 'ready');
      return;
    }
    if (p.stage === 'stalled') {
      daemonState.log('索引进度 stalled，继续');
      daemonState.setProjectPhase(projectPath, 'ready');
      return;
    }
    if (p.percent !== undefined) {
      daemonState.updateProgress('indexing', 50 + Math.floor(p.percent * 0.5), `workspace 索引中 (${p.percent}%)...`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  daemonState.log(`索引等待超时 (${maxWait / 1000}s)，继续`);
  daemonState.setProjectPhase(projectPath, 'ready');
}
```

- [ ] **Step 2: 将 `waitForBuildImport` 改为异步 `scheduleBuildImportAsync`**

将现有 `waitForBuildImport` 函数重命名并改为异步调度。修改函数签名和调用方式：

```typescript
/**
 * SP05：异步后台等待 Maven/Gradle 构建导入完成
 *
 * 不影响 ready 状态，独立在后台运行。
 * 完成后更新 daemonState.updateBuildImportProgress() 供 /health 暴露。
 */
function scheduleBuildImportAsync(projectPath: string): void {
  queueMicrotask(async () => {
    try {
      const buildFileDetected = ['pom.xml', 'build.gradle', 'build.gradle.kts']
        .some(f => fs.existsSync(path.join(projectPath, f)));

      if (!buildFileDetected) {
        daemonState.updateBuildImportProgress(projectPath, {
          stage: 'completed', percent: 100, lastUpdated: Date.now(),
        });
        return;
      }

      const buildType = fs.existsSync(path.join(projectPath, 'pom.xml')) ? 'Maven' : 'Gradle';
      daemonState.log(`[buildImport] 检测到 ${buildType} 项目，异步等待依赖导入...`);
      daemonState.updateBuildImportProgress(projectPath, {
        stage: 'in_progress', percent: 0, title: `${buildType} 依赖导入`,
        lastUpdated: Date.now(),
      });

      // Phase 1: 等待首次 import 进度（60s 超时）
      const firstProgressTimeout = Date.now() + 60_000;
      let importDetected = false;

      while (Date.now() < firstProgressTimeout) {
        const p = daemonState.getIndexProgress(projectPath);
        if (p && p.stage !== 'not_started') {
          const title = (p.title || '').toLowerCase();
          if (/import/i.test(title)) {
            importDetected = true;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!importDetected) {
        daemonState.log(`[buildImport] ${buildType} 导入未检测到进度，可能已完成或无需导入`);
        daemonState.updateBuildImportProgress(projectPath, {
          stage: 'completed', percent: 100, lastUpdated: Date.now(),
        });
        return;
      }

      // Phase 2: 等待完成（300s 超时）
      const maxWait = 300_000;
      const startWait = Date.now();

      while (Date.now() - startWait < maxWait) {
        const p = daemonState.getIndexProgress(projectPath);
        if (!p) { await new Promise(r => setTimeout(r, 500)); continue; }
        if (p.stage === 'completed') {
          daemonState.log('[buildImport] 构建导入完成 (Lombok 支持已就绪)');
          daemonState.updateBuildImportProgress(projectPath, {
            stage: 'completed', percent: 100, title: p.title,
            lastUpdated: Date.now(),
          });
          return;
        }
        if (p.stage === 'stalled') {
          daemonState.log('[buildImport] 导入进度 stalled，可能已超时');
          daemonState.updateBuildImportProgress(projectPath, {
            stage: 'stalled', percent: p.percent, lastUpdated: Date.now(),
          });
          return;
        }
        if (p.percent !== undefined) {
          daemonState.updateBuildImportProgress(projectPath, {
            stage: 'in_progress', percent: p.percent, title: p.title,
            lastUpdated: Date.now(),
          });
        }
        await new Promise(r => setTimeout(r, 500));
      }

      daemonState.log(`[buildImport] ${buildType} 导入等待超时 (${maxWait / 1000}s)`);
      daemonState.updateBuildImportProgress(projectPath, {
        stage: 'stalled', lastUpdated: Date.now(),
      });
    } catch (e: any) {
      daemonState.log(`[buildImport] 异常: ${e?.message || e}`);
    }
  });
}
```

- [ ] **Step 3: 调整 `initClient()` 中的调用顺序**

修改 `initClient()` 中多项目路径（line 42-58）和 `doInitClient()`（line 140-145）：

**多项目路径** (`initClient()` line 47-49):

```typescript
    daemonState.setLastLoadEvent(result.loadEvent);
    if (result.loadEvent?.type !== 'reused') {
      daemonState.updateProgress('indexing', 50, '等待 workspace 索引完成...');
      await waitForIndexing(projectPath);
    }
    // 异步后台 Maven 导入（不阻塞 ready）
    if (result.loadEvent?.type !== 'reused') {
      scheduleBuildImportAsync(projectPath);
    }
```

**单项目路径** (`doInitClient()` line 141-144):

```typescript
      await activeClient.start();
      daemonState.setProjectPhase(projectPath, 'indexing');
      daemonState.updateProgress('indexing', 50, '等待 workspace 索引完成...');
      await waitForIndexing(projectPath);
      daemonState.setClientReady(true);
      // 异步后台 Maven 导入
      scheduleBuildImportAsync(projectPath);
```

- [ ] **Step 4: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/daemon/services/projectService.ts
git commit -m "feat: add waitForIndexing, async build import, reorder initClient flow"
```

---

### Task 4: routeHandlers — 就绪检查 + 结构化错误 + 多项目模式修复

**Files:**
- Modify: `src/daemon/routes/routeHandlers.ts:100-308`

- [ ] **Step 1: 新增 postProjectLoad 处理函数**

在文件末尾（`handleHealthCheck` 之前）添加 `/project-load` 端点路由。先修改 `setupRequestRouter` 中 route 匹配部分（在 line 52 `/projects` 之后插入）：

```typescript
    // 注册新项目（多项目模式）
    if (pathname === '/project-load') {
      const loadBody = await parseBody(req);
      await handleProjectLoad(loadBody, res, startTime);
      return;
    }
```

在文件末尾（在 `export async function setupRequestRouter` 的闭合 `}` 之前）添加 handler 函数：

```typescript
/**
 * 处理 /project-load — 显式注册新项目
 */
async function handleProjectLoad(
  body: any,
  res: http.ServerResponse,
  startTime: number
): Promise<void> {
  const { project, jdtlsPath } = body;

  if (!project) {
    sendResponse(res, {
      success: false,
      code: 'MISSING_PARAMETER',
      error: 'Missing required parameter: project',
      elapsed: Date.now() - startTime,
    });
    return;
  }

  const projectPool = daemonState.getProjectPool();
  if (!projectPool) {
    sendResponse(res, {
      success: false,
      code: 'NOT_MULTI_PROJECT',
      error: 'Multi-project mode is not enabled. Start daemon without --single-project flag.',
      elapsed: Date.now() - startTime,
    });
    return;
  }

  // 检查是否已在加载
  const existingStatus = projectPool.getStatus(project);
  if (existingStatus && existingStatus !== 'not_loaded') {
    const phase = daemonState.getProjectPhase(project);
    sendResponse(res, {
      success: true,
      data: {
        project,
        status: existingStatus,
        phase: phase || 'indexing',
      },
      progress: {
        checkUrl: 'http://127.0.0.1:9876/health',
        estimatedWait: existingStatus === 'ready' ? '已就绪' : '约30-60秒',
      },
      elapsed: Date.now() - startTime,
    });
    return;
  }

  try {
    // 调用 initClient（内部通过 projectPool 管理）
    const { loadEvent } = await initClient(project, { jdtlsPath });

    sendResponse(res, {
      success: true,
      data: {
        project,
        loadEvent,
        phase: daemonState.getProjectPhase(project) || 'indexing',
      },
      progress: {
        checkUrl: 'http://127.0.0.1:9876/health',
        estimatedWait: '约30-60秒',
      },
      elapsed: Date.now() - startTime,
    });
  } catch (error: any) {
    sendResponse(res, {
      success: false,
      code: 'PROJECT_LOAD_FAILED',
      error: error.message,
      elapsed: Date.now() - startTime,
    });
  }
}
```

- [ ] **Step 2: 新增就绪检查函数 `checkProjectReadiness()`**

```typescript
/**
 * 检查项目就绪状态，返回 null 表示可继续，否则返回结构化错误
 */
function checkProjectReadiness(
  project: string,
  res: http.ServerResponse,
  startTime: number
): boolean {
  const projectPool = daemonState.getProjectPool();

  // 多项目模式：检查项目是否已注册
  if (projectPool) {
    const status = projectPool.getStatus(project);
    if (!status || status === 'not_loaded') {
      sendResponse(res, {
        success: false,
        code: 'PROJECT_NOT_LOADED',
        message: '项目未注册到守护进程',
        recovery: {
          suggestion: '请先注册项目后再发送命令',
          action: `curl -X POST http://127.0.0.1:9876/project-load -H 'Content-Type: application/json' -d '{"project": "${project}"}'`,
          checkStatus: 'curl http://127.0.0.1:9876/health',
          estimatedWait: '首次加载约 30-60 秒',
        },
        elapsed: Date.now() - startTime,
      });
      return true; // 已处理
    }

    // 检查是否正在索引
    const phase = daemonState.getProjectPhase(project);
    if (phase === 'indexing' || phase === 'connecting') {
      const indexProgress = daemonState.getIndexProgress(project);
      const percent = indexProgress?.percent || 0;
      sendResponse(res, {
        success: false,
        code: 'PROJECT_INDEXING',
        message: `项目正在建立索引，当前 ${percent}%`,
        recovery: {
          suggestion: '等待索引完成后重试',
          checkStatus: 'curl http://127.0.0.1:9876/health',
          indexPercent: percent,
          estimatedRemaining: percent < 30 ? '约 2-5 分钟' : '约 1-2 分钟',
        },
        elapsed: Date.now() - startTime,
      });
      return true; // 已处理
    }
  } else {
    // 单项目模式：检查 ready
    const isReady = daemonState.isClientReady();
    if (!isReady) {
      const initProgress = daemonState.getInitProgress();
      sendResponse(res, {
        success: false,
        code: 'PROJECT_INDEXING',
        message: `项目正在初始化: ${initProgress.message}`,
        recovery: {
          suggestion: '等待初始化完成后重试',
          checkStatus: 'curl http://127.0.0.1:9876/health',
          indexPercent: initProgress.percent,
          estimatedRemaining: '约 1-2 分钟',
        },
        elapsed: Date.now() - startTime,
      });
      return true; // 已处理
    }
  }

  return false; // 可以继续
}
```

- [ ] **Step 3: 在命令入口处集成就绪检查 + 移除多项目不匹配拦截**

修改 `setupRequestRouter()` 中 line 100-125 的区域：

```typescript
    // 验证项目路径
    if (!project) {
      sendResponse(res, {
        success: false,
        error: 'Missing required parameter: project',
        elapsed: Date.now() - startTime,
      });
      return;
    }

    // 检查项目就绪状态
    if (checkProjectReadiness(project, res, startTime)) {
      return;
    }

    // 多项目模式：跳过项目不匹配检查，透传给 initClient → projectPool
    const projectPool = daemonState.getProjectPool();
    if (!projectPool) {
      // 单项目模式：保留项目不匹配拦截
      const normalizePathForCompare = (p: string) => {
        const resolved = path.resolve(p);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      };
      const currentProject = daemonState.getCurrentProject();
      if (currentProject && normalizePathForCompare(currentProject) !== normalizePathForCompare(project)) {
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
    }

    // 初始化客户端
    const { client: activeClient, loadEvent } = await initClient(project, options);
```

- [ ] **Step 4: 在现有响应构建中添加 buildImport hint（line 268-290 附近）**

在成功响应的 metadata 中添加 buildImport hint：

```typescript
    // 响应中附加 buildImport hint（Maven 导入后台未完成时）
    const buildImportProgress = daemonState.getBuildImportProgress(project);
    if (buildImportProgress && buildImportProgress.stage === 'in_progress') {
      metadata.hint = {
        buildImport: `Maven 依赖导入尚未完成 (${buildImportProgress.percent || 0}%)，无重大影响，仅涉及 Lombok 生成的 get/set 方法暂时不可见`,
      };
    }
```

- [ ] **Step 5: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误，特别注意新增的 import 正确

- [ ] **Step 6: 提交**

```bash
git add src/daemon/routes/routeHandlers.ts
git commit -m "feat: add readiness checks, structured errors, /project-load, multi-project fix"
```

---

### Task 5: 增强 /health 端点

**Files:**
- Modify: `src/daemon/routes/routeHandlers.ts` (handleHealthCheck 函数，约 line 315+)

- [ ] **Step 1: 增强项目状态构建逻辑**

修改 `handleHealthCheck` 中的项目状态构建部分。找到构建 `projectState` 的代码块（约 line 327-330），替换为：

```typescript
  // 构建项目列表（多项目模式）
  let projects: any[] = [];
  let overallStatus: string = 'idle';

  if (projectPool && currentProject) {
    const phaseOrder: Record<string, number> = {
      'ready': 0, 'indexing': 1, 'connecting': 2, 'error': 3,
    };
    const activeProjects = projectPool.getActiveProjects ? projectPool.getActiveProjects() : [currentProject];

    for (const projPath of activeProjects) {
      const phase = daemonState.getProjectPhase(projPath) || 'indexing';
      const indexP = daemonState.getIndexProgress(projPath);
      const buildImportP = daemonState.getBuildImportProgress(projPath);

      const projEntry: any = {
        path: projPath,
        status: phase === 'ready' ? 'ready' : phase === 'error' ? 'error' : 'loading',
        phase,
        indexProgress: indexP || { stage: 'not_started', percent: 0, lastUpdated: Date.now() },
      };

      if (buildImportP && buildImportP.stage !== 'completed') {
        projEntry.buildImport = buildImportP;
      }

      projects.push(projEntry);

      // overallStatus 取最差
      const currentOrder = phaseOrder[phase] ?? 0;
      const overallOrder = phaseOrder[overallStatus] ?? 0;
      if (currentOrder > overallOrder) {
        overallStatus = phase;
      }
    }
  } else {
    // 单项目模式
    const phase = currentProject ? (daemonState.getProjectPhase(currentProject) || (isReady ? 'ready' : initProgress.stage === 'error' ? 'error' : 'indexing')) : 'idle';
    overallStatus = phase as string;

    if (currentProject) {
      const indexP = daemonState.getIndexProgress(currentProject);
      const buildImportP = daemonState.getBuildImportProgress(currentProject);
      const projEntry: any = {
        path: currentProject,
        status: isReady ? 'ready' : initProgress.stage === 'error' ? 'error' : 'loading',
        phase,
        indexProgress: indexP || { stage: 'not_started', lastUpdated: Date.now() },
      };
      if (buildImportP && buildImportP.stage !== 'completed') {
        projEntry.buildImport = buildImportP;
      }
      projects.push(projEntry);
    }
  }

  // ... 其余 health 响应构建代码，将 overallStatus 和 projects 注入响应体
```

- [ ] **Step 2: 更新 health 响应体**

在 `sendResponse` 调用处确保包含 `overallStatus` 和 `projects` 字段。

- [ ] **Step 3: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/daemon/routes/routeHandlers.ts
git commit -m "feat: enhance /health with phase, buildImport, per-project status"
```

---

### Task 6: projectPool 新增 getStatus 方法

**Files:**
- Modify: `src/projectPool.ts:72-113`

- [ ] **Step 1: 新增 `getStatus()` 和 `getActiveProjects()` 方法**

在 `getClient` 方法之后添加：

```typescript
  /**
   * 获取项目状态（供健康端点和就绪检查使用）
   */
  getStatus(projectPath: string): 'initializing' | 'ready' | 'error' | 'not_loaded' {
    const normalized = this.normalizeProjectPath(projectPath);
    const entry = this.clients.get(normalized);
    if (!entry) return 'not_loaded';
    return entry.status;
  }

  /**
   * 获取所有活跃项目路径列表
   */
  getActiveProjects(): string[] {
    return Array.from(this.clients.keys());
  }
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/projectPool.ts
git commit -m "feat: add getStatus and getActiveProjects to ProjectPool"
```

---

### Task 7: 完整构建 + 现有测试回归

**Files:**
- 无新建/修改

- [ ] **Step 1: 完整 TypeScript 构建**

Run: `npx tsc`
Expected: 无错误，生成 dist/

- [ ] **Step 2: 运行现有测试套件**

Run: `npm test`
Expected: 所有已有测试通过（注意：daemon 模式性能测试阈值可能因新等待逻辑变化，需要调整）

- [ ] **Step 3: 如果有测试失败，检查并调整**

重点检查 `test/e2e/daemonMode.test.ts` 的性能阈值：
- 首次命令可能因 `waitForIndexing` 稍慢（取决于项目大小）
- 复用命令应保持快速（`reused` 跳过等待）

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: full build verification after daemon readiness refactor"
```

---

### Task 8: 端到端验证（手动）

- [ ] **Step 1: 启动 daemon 并观察 phase 流转**

```bash
# 启动 daemon（后台）
node dist/cli.js daemon start -p /path/to/java-project

# 轮询 health 观察 phase 变化
for i in $(seq 1 60); do
  curl -s http://127.0.0.1:9876/health | jq '{overallStatus, projects: [.projects[] | {path, phase, indexProgress: .indexProgress.stage}]}'
  sleep 2
done
```

Expected: `overallStatus` 按 `connecting → indexing → ready` 流转

- [ ] **Step 2: 测试 PROJECT_INDEXING 拒绝**

在 daemon 刚启动（phase=indexing）时发送子命令：

```bash
curl -s -X POST http://127.0.0.1:9876/find -H 'Content-Type: application/json' -d '{"project": "/path/to/project", "symbol": "Test"}'
```

Expected: 返回 `{"success": false, "code": "PROJECT_INDEXING", ...}`

- [ ] **Step 3: 测试 PROJECT_NOT_LOADED 引导**

用另一个项目路径发送命令（多项目模式）：

```bash
curl -s -X POST http://127.0.0.1:9876/find -H 'Content-Type: application/json' -d '{"project": "/path/to/other-project", "symbol": "Test"}'
```

Expected: 返回 `{"success": false, "code": "PROJECT_NOT_LOADED", "recovery": {...}}`

- [ ] **Step 4: 测试 /project-load 注册**

```bash
curl -s -X POST http://127.0.0.1:9876/project-load -H 'Content-Type: application/json' -d '{"project": "/path/to/other-project"}'
```

Expected: 返回 `{"success": true, "data": {"loadEvent": {...}}, ...}`
