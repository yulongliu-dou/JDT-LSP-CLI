# 守护进程结构化就绪模型设计

> **状态**: 已审批
> **关联**: 基于 `fix/daemon-improvements` 分支

**目标**: 解决守护进程三个核心问题——健康检查过早返回 ready、Maven 导入等待超时过短、多项目无法自动发现。

---

## 一、项目就绪阶段模型

当前 `IndexProgress.stage` 仅区分 `not_started | in_progress | completed | stalled`，无法表达"JDT LS 已连接但 Maven 导入仍在后台"等中间态。

### 新增类型

```typescript
// src/core/types.ts
type ProjectPhase = 'connecting' | 'indexing' | 'ready' | 'error';
```

### 阶段流转

```
JDT LS start()  ──→  indexing  ──→  ready
     │                  │               │
     │ 启动失败          │ 索引失败       │ Maven 导入（异步后台，不阻塞 ready）
     ↓                  ↓               ↓
   error              error      scheduleBuildImportAsync()
                                       │
                                 内部轮询 $/progress
                                 完成后更新 indexProgressMap
                                 供 /health 暴露
```

### 阶段定义

| 阶段 | 含义 | 可接受的查询 |
|------|------|-------------|
| `connecting` | LSP 连接建立中 | 无 |
| `indexing` | workspace 源文件索引中 | 查询可能慢/结果不完整 |
| `ready` | 索引完成，正常可用 | 全部可用（Lombok get/set 可能暂不可见，等 Maven 导入后台完成） |
| `error` | 启动或索引失败 | 无 |

### 关键设计决策

- **Maven 导入不阻塞 ready**：因为其影响面仅限于 Lombok 生成的 get/set 方法不可见，不应成为整个 daemon 就绪的硬依赖
- **索引完成后可查询**：JDT LS 的 `$/progress` 索引 job（非 import 类）完成后，find/def/refs/ch 均可正常使用

---

## 二、超时与等待增强

### 2.1 超时参数调整（`src/daemon/services/projectService.ts`）

| 参数 | 原值 | 新值 | 说明 |
|------|------|------|------|
| 首进度检测超时 | 15s | 60s | Maven 大项目解析 POM + 下载插件可能超 15s |
| 导入总超时 | 120s | 300s | 首次下载全部依赖可能很慢 |

### 2.2 新增 `waitForIndexing()`

在 JDT LS `start()` 成功后调用，轮询 `$/progress` 通知中**非 import 类**的 build/index/workspace job：

- 首进度检测：30s（无 job 出现则跳过，项目可能无构建文件）
- 总超时：300s
- 中途实时更新 `daemonState.updateProgress()`（阶段标记为 `indexing`）
- 超时/stalled 则跳过，不阻塞

### 2.3 `waitForBuildImport` → `scheduleBuildImportAsync`

原函数改为异步后台调度：

```typescript
// 原: await waitForBuildImport(projectPath);   // 同步阻塞
// 新:
scheduleBuildImportAsync(projectPath);           // 异步，不阻塞 ready
```

实现使用 `queueMicrotask` 包装原等待逻辑，完成后将结果写入 `indexProgressMap` 的 `buildImport` 字段。

### 2.4 `initClient()` 调用顺序

```typescript
await activeClient.start();                    // connecting
daemonState.updateProgress('indexing', ...);
await waitForIndexing(projectPath);            // indexing（同步）
daemonState.setClientReady(true);              // ready
scheduleBuildImportAsync(projectPath);         // Maven 导入（异步，不阻塞）
```

---

## 三、透明排队与结构化错误

子命令到达时，根据目标项目状态返回不同响应。

### 3.1 项目未注册（多项目模式）

```json
{
  "success": false,
  "code": "PROJECT_NOT_LOADED",
  "message": "项目未注册到守护进程",
  "recovery": {
    "suggestion": "请先注册项目后再发送命令",
    "action": "curl -X POST http://127.0.0.1:9876/project-load -H 'Content-Type: application/json' -d '{\"project\": \"/path/to/project\"}'",
    "checkStatus": "curl http://127.0.0.1:9876/health",
    "estimatedWait": "首次加载约 30-60 秒"
  }
}
```

### 3.2 项目索引中

```json
{
  "success": false,
  "code": "PROJECT_INDEXING",
  "message": "项目正在建立索引，当前 45%",
  "recovery": {
    "suggestion": "等待索引完成后重试",
    "checkStatus": "curl http://127.0.0.1:9876/health",
    "indexPercent": 45,
    "estimatedRemaining": "约 1-2 分钟"
  }
}
```

### 3.3 Maven 导入后台未完成

命令**正常执行**，仅在响应末尾附带 hint：

```json
{
  "success": true,
  "data": { ... },
  "hint": {
    "buildImport": "Maven 依赖导入尚未完成 (60%)，无重大影响，仅涉及 Lombok 生成的 get/set 方法暂时不可见"
  }
}
```

### 3.4 实现位置

`src/daemon/routes/routeHandlers.ts`：命令分发入口处，在调用 `initClient()` 之前做就绪检查和项目存在性检查。

---

## 四、多项目自动发现与注册

### 4.1 移除项目不匹配拦截

`routeHandlers.ts` 当前在 `currentProject` 已设置时，对不同项目的请求直接返回 PROJECT_MISMATCH 错误。多项目模式下此拦截不适用。

**修改**：多项目模式下跳过此检查，将项目路径透传给 `initClient()`。

单项目模式下保留现有拦截逻辑不变。

### 4.2 新增 `POST /project-load` 端点

**请求**:
```json
{ "project": "/absolute/path", "jdtlsPath?": "..." }
```

**成功响应**:
```json
{
  "success": true,
  "loadEvent": { "type": "new", "projectPath": "...", "loadTime": 2340 },
  "progress": { "checkUrl": "http://127.0.0.1:9876/health", "estimatedWait": "约30秒" }
}
```

**池满处理**：现有 LRU 驱逐自动处理，不报错。drain 中返回 `PROJECT_EVICTING` 提示稍后重试。

### 4.3 注册流程

```
Agent 发送子命令 → 返回 PROJECT_NOT_LOADED（含 recovery）
Agent 调用 POST /project-load → daemon 调用 initClient() → 返回 loadEvent
Agent 轮询 /health → 确认 ready
Agent 重新发送原命令 → 正常执行
```

---

## 五、健康端点增强

`GET /health` 响应扩展：

```json
{
  "overallStatus": "indexing",
  "status": "indexing",
  "projects": [
    {
      "path": "/home/user/project-a",
      "status": "ready",
      "phase": "ready",
      "indexProgress": { "stage": "ready", "percent": 100 }
    },
    {
      "path": "/home/user/project-b",
      "status": "indexing",
      "phase": "indexing",
      "indexProgress": { "stage": "in_progress", "percent": 45, "title": "Building workspace" },
      "buildImport": { "stage": "in_progress", "percent": 60 }
    }
  ],
  "uptime": 123456,
  "pid": 1234
}
```

### 5.1 新增/修改字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `overallStatus` | `ProjectPhase` | 取所有 project 的最差状态 |
| `projects[].phase` | `ProjectPhase` | 当前所处就绪阶段 |
| `projects[].buildImport` | `IndexProgress?` | Maven 导入进度，非 Maven 项目为 null |
| `projects[].indexProgress` | `IndexProgress` | 扩展现有字段，stage 改为 `ProjectPhase` 联合类型 |

### 5.2 overallStatus 计算规则

`ready < indexing < connecting < error`

取所有 project 中排序最高的（最差）状态。单项目模式直接用当前项目的 phase。

---

## 六、涉及文件

| 文件 | 改动 |
|------|------|
| `src/core/types.ts` | 新增 `ProjectPhase` 类型；`IndexProgress.stage` 扩展 |
| `src/daemon/services/projectService.ts` | 新增 `waitForIndexing()`；`waitForBuildImport` → `scheduleBuildImportAsync`；调整 `initClient()` 调用顺序 |
| `src/daemon/core/daemonStateManager.ts` | `indexProgressMap` 支持 `buildImport` 独立字段 |
| `src/daemon/routes/routeHandlers.ts` | 新增 `POST /project-load`；命令入口增加就绪检查 + 结构化错误；移除多项目模式下的项目不匹配拦截 |
| `src/projectPool.ts` | 新增 `getStatus(projectPath)` 方法；暴露 per-project phase |

---

## 七、测试要点

1. **就绪阶段**：启动 daemon → `/health` 的 `phase` 按 `connecting → indexing → ready` 流转
2. **INDEXING 拒绝**：索引期间发子命令 → 返回 `PROJECT_INDEXING` + 百分比
3. **NOT_LOADED 引导**：多项目模式下新项目请求 → `PROJECT_NOT_LOADED` + recovery action
4. **/project-load**：注册新项目 → 异步初始化 → `/health` 可查进度 → 索引完成后子命令正常
5. **buildImport hint**：Maven 项目子命令 → 响应携带 `hint.buildImport`（如导入未完成）
6. **超时**：导入首进度 60s / 总超时 300s / 索引总超时 300s，超时后不阻塞 ready
