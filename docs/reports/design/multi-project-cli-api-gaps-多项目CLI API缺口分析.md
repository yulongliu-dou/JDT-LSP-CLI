# 多项目模式 CLI/API 功能补齐设计

## 1. 背景

`daemon.maxProjects` 默认值已从 1 调整为 3，守护进程默认以多项目模式运行。审计发现三个功能缺口需要补齐。

### 1.1 关键代码位置

| 模块 | 文件 | 行号 |
|------|------|------|
| CLI status 命令 | `src/cli/commands/daemon.ts` | 124-245 |
| CLI release 命令 | `src/cli/commands/daemon.ts` | 341-364 |
| CLI start 子命令注册 | `src/cli/commands/daemon.ts` | 51-102 |
| HTTP `/status` handler | `src/daemon/routes/routeHandlers.ts` | 246-403 |
| HTTP `/shutdown` handler | `src/daemon/routes/routeHandlers.ts` | 408-427 |
| HTTP `/release` handler | `src/daemon/routes/routeHandlers.ts` | 946-970 |
| 信号处理（SIGTERM） | `src/daemon/http/httpServer.ts` | 141-163 |
| `ProjectPool.releaseProject` | `src/projectPool.ts` | 226-245 |
| `ProjectPool.evictLRU` | `src/projectPool.ts` | 187-221 |
| `ProjectPool.markDraining` | `src/projectPool.ts` | 310-321 |
| `ProjectPool.incrementRequests` | `src/projectPool.ts` | 330-337 |

### 1.2 现状：已具备的能力

| 能力 | CLI 命令 | HTTP 端点 | 状态 |
|------|----------|-----------|------|
| 列出所有加载的项目 | `jls daemon list` | `GET /projects` | ✅ |
| 详细状态含多项目 | `jls daemon status --verbose` | `POST /status` | ✅ |
| 释放指定项目 | `jls daemon release <path>` | `POST /release` | ✅ |
| 系统/项目内存监控 | `jls daemon memory` | `POST /memory` | ✅ |
| 自动伸缩热配置 | `jls daemon config --auto-scaling ...` | `POST /config` | ✅ |
| ProjectPool 完整 API | — | — | ✅ |

---

## 2. 问题 1：`jls daemon status` 非 verbose 模式无多项目信息

### 2.1 现状

`src/cli/commands/daemon.ts:148-161`：

```typescript
const projectPath = d.project?.path || 'none';
console.log(`Project: ${projectPath}`);
console.log(`Status: ${d.status}`);
console.log(`Uptime: ${Math.floor(d.uptime)}s`);
```

- `d.project` 在多项目模式下永远为 `null`（因为 `daemonState.currentProject` 只在单项目初始化时设置，见 `projectService.ts:110`）
- 用户看到 `Project: none`，误以为没有项目加载
- 项目数组 `d.projects` 已由 `/status` 端点返回（`routeHandlers.ts:304`），但 CLI 只在 `--verbose` 分支使用

### 2.2 设计方案

非 verbose 模式下输出紧凑的项目摘要列表，保持简洁但不再误导：

```
$ jls daemon status
Daemon status: RUNNING
PID: 12345
Port: 9876
Version: 2.2.0
Started: 2026-05-17 14:30:00
Status: ready
Uptime: 3600s
Projects (2/3):
  /path/to/project-a  ready       15m ago
  /path/to/project-b  loading     2s ago
```

**改动点：**

1. `src/cli/commands/daemon.ts` status 命令非 verbose 分支：
   - 删除 `d.project?.path` 单项目路径展示
   - 若 `d.projects` 非空，输出 `Projects (n/m):` 行和每个项目的路径、状态、最后访问时间
   - 若 `d.projects` 为空，输出 `Projects: none`
   - 保持 `d.status` 的总体状态展示不变

2. 输出格式：
   - 路径列左对齐，固定宽度（截断过长路径，取末 50 字符）
   - 状态用颜色/标记区分：ready / loading / error / draining
   - 最后访问时间用相对时间（`15m ago`）

**不改动：** `/status` 端点已返回 `projects` 数组，无需修改服务端。

---

## 3. 问题 2：HTTP `/shutdown` 多项目下孤儿进程

### 3.1 现状

`src/daemon/routes/routeHandlers.ts:408-427`：

```typescript
async function handleShutdown(res, startTime) {
  sendResponse(res, { ... });
  setTimeout(async () => {
    const client = daemonState.getClient();  // 多项目模式返回 null
    if (client) {
      await client.stop();                   // 永远不执行
    }
    // 删除 PID ...
    process.exit(0);                         // 直接退出，JDT LS 子进程变孤儿
  }, 100);
}
```

对比信号路径 `httpServer.ts:141-163`，其正确处理了两种模式：

```typescript
if (projectPool) {
  await projectPool.shutdown();   // ✅ 多项目
} else if (client) {
  await client.stop();            // ✅ 单项目
}
```

**影响：** 用户通过 HTTP 调用 `/shutdown`（而非 `jls daemon stop`）时，JDT LS Java 子进程不会被终止，成为孤儿进程继续占用内存。

### 3.2 设计方案

将 `handleShutdown` 的清理逻辑与 `httpServer.ts` 信号处理对齐：

```typescript
async function handleShutdown(res, startTime) {
  sendResponse(res, { ... });
  setTimeout(async () => {
    daemonState.log('Shutdown requested, cleaning up...');
    const projectPool = daemonState.getProjectPool();
    const client = daemonState.getClient();
    if (projectPool) {
      await projectPool.shutdown();       // 多项目：停止所有子进程
    } else if (client) {
      await client.stop();                // 单项目：停止唯一客户端
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    process.exit(0);
  }, 100);
}
```

**改动点：** `src/daemon/routes/routeHandlers.ts:415-424`，仅此一处。

---

## 4. 问题 3：缺少 `jls daemon stop-project <path>` 命令

### 4.1 现状

- `jls daemon release <path>`：调用 `releaseProject()`，直接停止客户端并从池中移除，**不考虑活跃请求**
- `ProjectPool` 已有 draining 机制（`markDraining` / `isDraining` / `activeRequests` 计数），但 release handler 没有使用
- 没有 CLI 命令可以直接"优雅停止"一个指定项目

### 4.2 设计方案

新增 `jls daemon stop-project <path>` 子命令，实现优雅停止：

**CLI 命令：**

```
jls daemon stop-project <projectPath>
```

- 发送 `POST /stop-project` 请求，body 为 `{ project: "<path>" }`
- 支持 `--force` 选项跳过 draining 直接 kill
- 输出：停止结果（成功/失败/超时）

**HTTP 端点：**

新增 `POST /stop-project` handler：

```typescript
async function handleStopProject(body, startTime) {
  const targetProject = body.project;
  const force = body.force === true;
  const projectPool = daemonState.getProjectPool();
  if (!projectPool) {
    return { error: 'Not in multi-project mode' };
  }
  if (!projectPool.hasProject(targetProject)) {
    return { error: `Project not loaded: ${targetProject}` };
  }
  if (!force) {
    // 优雅停止：标记 draining，等待活跃请求完成
    projectPool.markDraining(targetProject);
    const drained = await waitForDrain(projectPool, targetProject, 5000);
    if (!drained) {
      return { error: 'Drain timeout', hint: 'Use --force to skip drain' };
    }
  }
  const released = await projectPool.releaseProject(targetProject);
  return { released, project: targetProject };
}
```

**辅助函数 `waitForDrain`：**

```typescript
async function waitForDrain(
  pool: ProjectPool,
  projectPath: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = pool.getActiveRequestCount(projectPath);
    if (active <= 0) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
```

### 4.3 与 `release` 命令的关系

| 维度 | `release` | `stop-project` |
|------|-----------|----------------|
| 意图 | 释放项目资源，允许后续重新加载 | 强制终止并移除 |
| draining | 无，直接停止 | 默认等待活跃请求完成 |
| force 选项 | 无 | `--force` 跳过 draining |
| LRU 状态 | 从池中移除 | 从池中移除 |
| 适用场景 | 正常切换项目 | 项目卡死/内存紧急回收 |

保留 `release` 作为轻量级释放，`stop-project` 作为带保护的强制停止。

---

## 5. 实施计划

### 5.1 任务拆解

| 编号 | 任务 | 文件 | 改动量 |
|------|------|------|--------|
| G1 | `jls daemon status` 非 verbose 多项目展示 | `src/cli/commands/daemon.ts` | ~20 行 |
| G2 | HTTP `/shutdown` 修复多项目孤儿进程 | `src/daemon/routes/routeHandlers.ts` | ~10 行 |
| G3 | 新增 `POST /stop-project` 端点 + `waitForDrain` | `src/daemon/routes/routeHandlers.ts` | ~35 行 |
| G4 | 新增 `jls daemon stop-project` CLI 命令 | `src/cli/commands/daemon.ts` | ~25 行 |

### 5.2 依赖关系

```
G2 (独立，单文件单函数)
G1 (独立，单文件单函数)
G3 → G4 (CLI 依赖 HTTP 端点)
```

G1、G2、G3 可并行实施（不同文件/不同函数无冲突），G4 在 G3 后实施。

### 5.3 测试要点

| 测试场景 | 验证内容 |
|----------|----------|
| `jls daemon status`（多项目，无 --verbose） | 展示项目列表而非 `Project: none` |
| `jls daemon status`（单项目，无 --verbose） | 回退到现有单项目展示 |
| `jls daemon status --verbose` | 与改动前行为一致 |
| `POST /shutdown`（多项目加载中） | JDT LS 子进程全部终止，PID 文件删除 |
| `POST /shutdown`（单项目） | 行为不变 |
| `POST /stop-project`（正常项目） | draining → 释放 → 子进程终止 |
| `POST /stop-project`（不存在项目） | 返回错误 |
| `POST /stop-project --force` | 跳过 draining 直接终止 |
| `jls daemon stop-project <path>` | CLI → HTTP 端到端正常 |
| draining 超时 | 返回超时错误 + `--force` 提示 |
