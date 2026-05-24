# Auto-Scaling Daemon — 功能点拆分与实现计划

> 基于 `docs/design/auto-scaling-daemon.md` 逐项分解，每个功能点可独立实现、测试、合入。

---

## 依赖关系总览

```
FP1 (JVM fix)          ← 无依赖，首发
    │
FP2 (类型系统 & 配置)    ← 无依赖，首发
    │
    ├── FP3 (MemoryMonitor)       ← 依赖 FP2
    ├── FP4 (ProjectPool 并发)    ← 依赖 FP2（类型引用）
    └── FP5 (索引进度追踪)        ← 依赖 FP2
              │
              └── FP6 (端点 & CLI) ← 依赖 FP3 + FP4 + FP5
```

FP3/FP4/FP5 互不依赖，可并行开发。

---

## FP1：JVM Headless 修复

**目标：** 修复 macOS Activity Monitor 中 JDT LS 进程显示"未响应"的问题。

**涉及文件：**

| 文件 | 改动 |
|---|---|
| `src/jdt/launcher.ts:55` (`buildJvmArgs()`) | 在方法开头追加 `args.push('-Djava.awt.headless=true')`，位于 `-Xms`/`-Xmx` 之前 |

**验证方式：**
- macOS 实机启动守护进程，Activity Monitor 中 JDT LS 进程不再显示红色"未响应"
- Windows/Linux 启动无副作用（该参数跨平台安全）

**预计工时：** 0.5h

---

## FP2：AutoScaling 类型系统 & 配置扩展

**目标：** 定义所有新增类型接口和配置项，为后续模块提供类型基础。本功能点仅添加类型定义和默认值，不改变运行时行为。

**涉及文件：**

| 文件 | 改动 |
|---|---|
| `src/core/types.ts` | 新增 `MemorySnapshot`、`PressureLevel`、`ProjectMemorySnapshot`、`ScaleAction`、`ScaleDecision`、`IndexProgress` 类型；`DaemonConfigOptions` 新增 `autoScaling?` 可选块 |
| `src/jdt/configLoader.ts` | `autoScaling` 默认值注入（`enabled: true`, `maxProjects: 3`, `scaleCooldownSeconds: 30`, `checkIntervalSeconds: 15`, `idleEvictMinutes: 30`, `maxSnapshotAgeMs: 60000`, `drainTimeoutMs: 5000`, `collectionTimeoutMs: 10000`） |

**关键类型：**

```typescript
// ----- Memory -----
interface MemorySnapshot {
  platform: 'darwin' | 'win32';
  timestamp: number;
  totalMB: number;
  freeMB: number;
  usedPercent: number;
  // macOS
  pageSize?: number;
  swapUsedMB?: number;
  memoryPressureFreePercent?: number;
  // Windows
  availableMB?: number;
  commitPercent?: number;
  // meta
  source: 'memory_pressure' | 'perf_counter' | 'cim_instance' | 'node_os';
  collectionDurationMs?: number;
  error?: string;
}

type PressureLevel = 'low' | 'moderate' | 'high' | 'critical' | 'unknown';

// ----- Project Process Memory -----
interface ProjectMemorySnapshot {
  projectPath: string;
  pid: number;
  rssMB: number;
  heapUsedMB?: number;
  heapTotalMB?: number;
  timestamp: number;
}

// ----- AutoScaling -----
interface ScaleAction {
  action: 'relax_capacity' | 'shrink' | 'evict_idle' | 'none';
  reason: string;
  targetProject?: string;
}

interface ScaleDecision {
  timestamp: number;
  degraded: boolean;
  degradedReason?: string;
  currentCount: number;
  capacity: number;
  pressureLevel: PressureLevel;
  action: ScaleAction;
  snapshotAgeMs?: number;
  snapshotStale?: boolean;
}

// ----- Index Progress -----
interface IndexProgress {
  stage: 'not_started' | 'in_progress' | 'completed' | 'stalled';
  title?: string;
  percent?: number;
  message?: string;
  lastUpdated: number;
}

// ----- Config Extension -----
// DaemonConfigOptions 新增:
autoScaling?: {
  enabled: boolean;               // default true
  minProjects: number;            // default 1
  maxProjects: number;            // default 3
  scaleCooldownSeconds: number;   // default 30
  checkIntervalSeconds: number;   // default 15
  idleEvictMinutes: number;       // default 30
  maxSnapshotAgeMs: number;       // default 60000
  drainTimeoutMs: number;         // default 5000
  collectionTimeoutMs: number;    // default 10000
  memoryThresholds?: { /* ... */ };
}
```

**向后兼容保证：**
- `autoScaling` 为可选块，不配置时全部使用默认值
- `autoScaling.enabled: false` 关闭自动伸缩，回退到现有固定 `maxProjects` 模式
- `maxProjects === 1` 时自动伸缩即使 enabled 也不生效

**预计工时：** 1h

---

## FP3：MemoryMonitor — 平台内存监控

**目标：** 实现系统级内存采集（macOS + Windows）+ 进程级 RSS 采集，含快照时效性、重试降级、自愈恢复。

**新增文件：**

| 文件 | 职责 |
|---|---|
| `src/daemon/core/memoryMonitor.ts` | MemoryMonitor 类，完整实现 |

**修改文件：**

| 文件 | 改动 |
|---|---|
| `src/jdtClient.ts` (`JdtLsClient`) | 暴露 `childProcess.pid`（当前已持有子进程引用，新增 getter） |

### 3.1 系统级内存采集

#### macOS 采集

```
memory_pressure → 解析:
  - 第一行 "page size of <N>" → pageSize
  - Pages free / active / inactive / wired down 等
  - Swapouts > 0 表示有 swap 压力
  - 最后一行 "System-wide memory free percentage: <N>%" → memoryPressureFreePercent
  ↓ 失败
sysctl vm.swapusage → 解析 swap 使用量 (MB)
  ↓ 全部失败
Node.js os.freemem() / os.totalmem() → source = 'node_os'
```

压力判定：

| pressureLevel | free% | swap |
|---|---|---|
| low | > 30% | — |
| moderate | 15%~30% | — |
| high | 8%~15% | 或 swap > 0 |
| critical | < 8% | 或 swap > 500MB |

#### Windows 采集

```
L1: Get-Counter '\Memory\Available MBytes','\Memory\% Committed Bytes In Use'
  → source = 'perf_counter'
  ↓ 失败
L2: Get-CimInstance Win32_OperatingSystem
  → source = 'cim_instance'
  ↓ 失败
L3: Node.js os.freemem() / os.totalmem()
  → source = 'node_os'
```

压力判定（L1 Available MBytes）：

| pressureLevel | Available MB | Commit% |
|---|---|---|
| low | > 2048 | < 60% |
| moderate | 1024~2048 | 60%~80% |
| high | 512~1024 | 80%~90% |
| critical | < 512 | > 90% |

L2/L3 降级阈值按文档 2.2 节对应调整。

### 3.2 快照时效性 & 降级

```
start(intervalMs) → 后台定时采集
  ├── 每次采集走完整 L1→L2→L3 链路
  ├── 成功: 更新缓存, consecutiveFailures = 0
  └── 三级全失败: consecutiveFailures++, error 写入 snapshot.error

getLatestSnapshot() → 同步返回缓存 (不阻塞)
getConsecutiveFailures() → 返回连续失败计数
isSnapshotStale() → Date.now() - snapshot.timestamp > maxSnapshotAgeMs
getPressureLevel() → 基于最新快照; 快照为 null 或过期返回 'unknown'

降级进入: consecutiveFailures >= 5
降级退出: 任一级别采集成功
```

### 3.3 进程级 RSS

```
async getProcessMemory(pid) → 执行平台命令, 返回 ProjectMemorySnapshot
  macOS:   ps -p <pid> -o rss=            (KB → MB)
  Windows: powershell "(Get-Process -Id <pid>).WorkingSet64"  (bytes → MB)

async getAllProcessMemory() → 遍历 projectPool 列表, 批量采集
```

### 3.4 核心方法签名

```typescript
class MemoryMonitor {
  static isMacOS(): boolean
  static isWindows(): boolean

  async getMemorySnapshot(): Promise<MemorySnapshot>

  start(intervalMs?: number): void
  stop(): void

  getLatestSnapshot(): MemorySnapshot | null
  getConsecutiveFailures(): number
  getPressureLevel(): PressureLevel
  isSnapshotStale(): boolean

  async getProcessMemory(pid: number): Promise<ProjectMemorySnapshot>
  async getAllProcessMemory(): Promise<ProjectMemorySnapshot[]>
}
```

**验证方式：**
- 单元测试：mock `memory_pressure` 输出（Intel 4K page / Apple Silicon 16K page 两份 fixture），验证解析正确性
- 单元测试：mock `Get-Counter` / `Get-CimInstance` 输出，验证 L1→L2→L3 降级链路
- 单元测试：mock 三级全失败，验证 consecutiveFailures 递增和 degraded 标记
- 手动测试：macOS Intel / Apple Silicon 实机对比 Activity Monitor
- 手动测试：Windows 10/11 实机对比任务管理器

**预计工时：** 5h

---

## FP4：ProjectPool 并发安全

**目标：** 在 ProjectPool 中加入 draining 机制，允许外部（AutoScaler）安全地驱逐项目，不中断已路由的 in-flight 请求。

**涉及文件：**

| 文件 | 改动 |
|---|---|
| `src/projectPool.ts` | `ProjectClient` 新增 `draining: boolean` + `activeRequests: number`；`getClient()` 检查 draining；新增 `markDraining()` / `unmarkDraining()` 方法；新增 `incrementRequests()` / `decrementRequests()` 方法 |

**核心变更：**

```typescript
interface ProjectClient {
  // ... 现有字段
  draining: boolean;        // 标记为待释放
  activeRequests: number;   // in-flight LSP 请求计数
}

// getClient() 中新增检查
async getClient(projectPath, options) {
  // ... 现有查找逻辑
  const existing = this.clients.get(normalizedPath);
  if (existing) {
    if (existing.draining) {
      throw new Error('Project is being evicted, please retry');
    }
    // ...
  }
}

// 新增方法
markDraining(projectPath: string): boolean
unmarkDraining(projectPath: string): void
incrementRequests(projectPath: string): void
decrementRequests(projectPath: string): void
getActiveRequestCount(projectPath: string): number
isDraining(projectPath: string): boolean
```

**并发安全性说明：**
- Node.js 单线程事件循环，`activeRequests++` / `activeRequests--` 天然原子
- `draining` 标记设置后同一 tick 内 `getClient()` 即可感知
- 不需要外部锁库

**验证方式：**
- 单元测试：模拟 getClient 在 draining=true 时抛出错误
- 单元测试：activeRequests 计数正确增减
- 手动测试：高频并发请求下无竞态崩溃

**预计工时：** 2h

---

## FP5：AutoScaler — 自动伸缩决策引擎

**目标：** 实现完整的扩缩容决策逻辑，集成到守护进程启动流程，处理与守护进程空闲超时的交互。

**新增文件：**

| 文件 | 职责 |
|---|---|
| `src/daemon/services/autoScaler.ts` | AutoScaler 类，完整实现 |

**修改文件：**

| 文件 | 改动 |
|---|---|
| `src/daemon.ts` | `startDaemon()` 中初始化 MemoryMonitor + AutoScaler，启动定时器；实现 2.5 节守护进程空闲超时交互规则 |
| `src/daemon/routes/routeHandlers.ts` | 所有 LSP 端点处理函数中：操作前 `pc.activeRequests++`，操作后 `finally` 中 `pc.activeRequests--` |

### 5.1 决策逻辑（严格按设计文档 3.2 节六步流程）

```
第一步: 检查内存监控状态 + 快照时效性
第二步: 空闲回收 (≥2 项目, 排除有活跃请求的候选)
第三步: 内存压力评估 → capacity (非 targetCount)
第四步: 容量上限检查 (超出 capacity 的标记 draining)
第五步: 冷却保护 (critical 豁免)
第六步: 执行 — 缩容带 drain, 扩容仅 relax_capacity
```

关键规则：
- `pressure === 'low'` → `capacity = min(current + 1, effectiveMaxProjects)`
- `pressure === 'critical'` → `capacity = 1`，立即执行
- 缩容：标记 draining → 等 activeRequests 清零 (max 5s) → releaseProject
- 扩容：仅更新 capacity，不创建项目（lazy）
- 池中只剩 1 个且 pressure=critical → 不释放，记录 warning

### 5.2 守护进程空闲超时交互

```
池中项目数 ≥ 1 → 守护进程 active，idleTimeoutMinutes 不触发
池中项目数 = 0 → 从清空时刻开始计时，超时后守护进程退出
池空但 idleTimeout 内有新请求到达 → 重置计时器，按需创建项目
```

### 5.3 effectiveMaxProjects

```
if config.daemon.maxProjects > 3:
  effectiveMaxProjects = config.daemon.maxProjects
else:
  effectiveMaxProjects = 3
```

### 5.4 AutoScaler 接口

```typescript
class AutoScaler {
  constructor(memoryMonitor: MemoryMonitor, projectPool: ProjectPool, config: DaemonConfig)

  start(intervalMs?: number): void
  stop(): void

  async evaluate(): Promise<ScaleDecision>

  getLatestDecision(): ScaleDecision | null
  get enabled(): boolean
}
```

**验证方式：**
- 单元测试：mock MemoryMonitor 返回 low/moderate/high/critical/unknown，验证 capacity 输出
- 单元测试：mock MemoryMonitor 返回 null，验证降级模式
- 单元测试：mock 快照过期，验证 pressureLevel = 'unknown'
- 单元测试：critical 压力下验证冷却被跳过
- 单元测试：idle 30min 项目被标记 evict_idle
- 单元测试：draining → 等 activeRequests 归零 → 释放（正常路径 + 超时路径）
- 手动测试：启动 3 个项目 → 模拟高内存 → 验证缩容到 1 个

**预计工时：** 5h

---

## FP6：索引进度追踪 & API 完整性标记

**目标：** 拦截 LSP `$/progress` 通知，维护每个项目的索引进度，实现 stalled 活性检测，在所有 LSP 查询响应中附加 `indexingComplete` 标记。

**涉及文件：**

| 文件 | 改动 |
|---|---|
| `src/jdt/lspConnection.ts` | 在 LSP 消息分发中拦截 `$/progress`，通过回调传出 |
| `src/daemon/core/daemonStateManager.ts` | 新增 `indexProgressMap: Map<string, IndexProgress>`，提供 `updateIndexProgress()` / `getIndexProgress()` / `checkStalled()` |
| `src/daemon/services/projectService.ts` | `initClient()` 中绑定 progress 回调 → DaemonStateManager |
| `src/daemon/routes/routeHandlers.ts` | 所有 LSP 操作端点响应中附加 `metadata.indexingComplete` |

### 6.1 $/progress 拦截

JDT LS 发送的进度通知格式：
```json
{ "method": "$/progress", "params": { "token": "build", "value": { "kind": "begin/report/end", "title": "Building workspace", "percentage": 58 } } }
```

拦截逻辑：
```
收到 $/progress:
  if kind === 'begin':
    → 创建/重置 IndexProgress { stage: 'in_progress', percent: 0 }
  if kind === 'report':
    → 更新 percent, message, lastUpdated
  if kind === 'end':
    → stage = 'completed', percent = 100
```

进度 token/title 做模糊匹配（包含 "build"/"index"/"import"/"workspace"），不依赖固定 token 值。

### 6.2 活性检测

```
checkStalled(): 遍历所有项目的 IndexProgress
  if stage === 'in_progress' AND Date.now() - lastUpdated > 10 * 60 * 1000:
    → stage = 'stalled'
```

在 AutoScaler 的 evaluate() 或独立定时器中调用 `checkStalled()`，确保 stalled 检测不依赖 `/status` 被调用。

### 6.3 API 完整性标记

所有 LSP 查询端点（`/definition`, `/references`, `/symbols`, `/workspace-symbols`, `/implementations`, `/hover`, `/call-hierarchy`, `/type-definition`）在响应中追加：

```json
{
  "success": true,
  "data": { /* ... */ },
  "metadata": {
    "indexingComplete": false  // 当前项目 IndexProgress.percent < 100 时
  }
}
```

**验证方式：**
- 单元测试：mock `$/progress` begin/report/end 序列，验证 IndexProgress 状态迁移
- 单元测试：mock in_progress + lastUpdated 超 10min，验证 stalled 标记
- 单元测试：percent=100 时 metadata.indexingComplete=true；percent<100 时=false
- 手动测试：大项目初始化期间发 `/workspace-symbols`，验证响应含 `indexingComplete: false`

**预计工时：** 3h

---

## FP7：/status & CLI 端点扩展

**目标：** `/status` 端点返回完整的内存快照、自动伸缩状态、索引进度、进程内存；新增 CLI 子命令。

**涉及文件：**

| 文件 | 改动 |
|---|---|
| `src/daemon/routes/routeHandlers.ts` | `handleHealthCheck()` 返回完整 `/status` 响应（memory + autoScaling + projects[] + indexProgress + processMemory） |
| `src/cli/commands/daemon.ts` | 新增 `jls daemon status --verbose`、`jls daemon memory` 子命令 |

### 7.1 /status 响应完整结构

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "progress": null,

    "project": { /* 当前项目, 含 indexProgress + processMemory */ },

    "projects": [
      {
        "path": "/path/to/project",
        "status": "ready",
        "loadTime": 12000,
        "lastAccess": 1715600000000,
        "priority": 0,
        "indexProgress": { "stage": "completed", "percent": 100 },
        "processMemory": { "pid": 12346, "rssMB": 1850, "timestamp": 1715600000000 }
      }
    ],

    "memory": {
      "platform": "win32",
      "pressureLevel": "low",
      "source": "perf_counter",
      "snapshotAgeMs": 3200,
      "snapshotStale": false,
      "snapshot": { /* MemorySnapshot 完整字段 */ },
      "consecutiveFailures": 0
    },

    "autoScaling": {
      "enabled": true,
      "degraded": false,
      "currentProjectCount": 2,
      "capacity": 3,
      "maxProjects": 3,
      "lastScaleAction": { "action": "relax_capacity", "reason": "..." },
      "lastScaleTime": 1715600005000
    },

    "uptime": 3600,
    "pid": 12345,
    "version": "2.1.0",
    "startTime": 1715600000000,
    "warnings": [],
    "libraryResolveEnabled": true
  }
}
```

### 7.2 CLI 命令

```
jls daemon status --verbose    # 打印完整 /status 响应（含 memory/autoScaling/projects）
jls daemon memory              # 打印当前内存快照 + 压力等级
```

**验证方式：**
- 手动测试：`curl localhost:9876/status`，验证所有新字段存在且格式正确
- 手动测试：`jls daemon status --verbose`，验证表格化输出
- 手动测试：`jls daemon memory`，验证内存快照格式化输出

**预计工时：** 2.5h

---

## 实现顺序建议

```
第1轮 (并行):  FP1 + FP2           ← 无依赖，首发合入
第2轮 (并行):  FP3 + FP4 + FP6     ← FP3/FP4/FP6 互不依赖
第3轮:         FP5                 ← 依赖 FP3 + FP4
第4轮:         FP7                 ← 依赖 FP3 + FP5 + FP6
```

## 预估总工时

| FP | 名称 | 工时 |
|---|---|---|
| FP1 | JVM Headless 修复 | 0.5h |
| FP2 | 类型系统 & 配置 | 1h |
| FP3 | MemoryMonitor | 5h |
| FP4 | ProjectPool 并发安全 | 2h |
| FP5 | AutoScaler 决策引擎 | 5h |
| FP6 | 索引进度追踪 | 3h |
| FP7 | 端点 & CLI 扩展 | 2.5h |
| **总计** | | **19h** |
