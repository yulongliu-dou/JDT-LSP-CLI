# 守护进程自动伸缩与健康状态设计

## 1. 现状分析

### 1.1 当前多项目支持程度

| 维度 | 现状 |
|---|---|
| 启用方式 | 配置项 `daemon.maxProjects`（默认 1），设为 >1 则激活 `ProjectPool` |
| 淘汰策略 | LRU + 优先级保护（先淘汰低优先级，同优先级淘汰最久未访问） |
| 内存限制 | 仅启动前预警（总内存 < 2GB 提示），运行时无监控 |
| 健康检查 | `/health` 和 `/status` 端点返回 ready/loading/error 状态 |
| 进度追踪 | `InitStage: idle → starting → jdt-launching → initializing → indexing → ready` |
| 项目数上限 | 仅由 `maxProjects` 配置项控制，无动态调整 |
| macOS 进程状态 | 缺少 `-Djava.awt.headless=true`，JVM 进程在 macOS Activity Monitor 中显示"未响应" |

### 1.2 关键代码位置

| 模块 | 文件 | 职责 |
|---|---|---|
| `ProjectPool` | `src/projectPool.ts` | 多项目 LRU 池管理 |
| `DaemonStateManager` | `src/daemon/core/daemonStateManager.ts` | 守护进程全局状态 |
| `initClient` | `src/daemon/services/projectService.ts` | 客户端初始化/切换 |
| `handleHealthCheck` | `src/daemon/routes/routeHandlers.ts:223` | 健康检查端点 |
| `loadConfig` | `src/jdt/configLoader.ts` | 配置加载与默认值 |
| `validateEnvironment` | `src/core/utils/daemonValidation.ts` | 环境预检（含内存预警） |
| `JdtLauncher.buildJvmArgs()` | `src/jdt/launcher.ts:55` | JVM 参数构建（缺失 headless 参数） |

### 1.3 "ready" 的当前含义

当前 `ready` 表示 JDT LS 的 LSP 连接已建立（`client.start()` 完成），但 JDT LS 内部的后台索引构建是持续进行的——LSP initialize 返回后，JDT LS 会在后台继续扫描/构建项目索引。

这意味着：

- 紧接 ready 后的 workspace/symbol 查询可能不完整
- 不同项目的索引进度独立
- 当前没有机制暴露索引进度给调用方

**设计决策：** 不做索引进度完成的硬性等待（不设超时），而是在 `/status` 端点中暴露每个项目的实时索引进度百分比，由调用方自行判断。

---

## 2. 目标需求

### 2.1 自动伸缩

- **最少保留 1 个**：无论内存压力多大，始终保留至少 1 个项目
- **默认最多 3 个**：内存充裕时自动放宽容量到 3 个项目（lazy: 不预初始化，实际加载由请求驱动）
- **超过 3 个需显式配置**：`maxProjects > 3` 时按配置值执行
- **容量 vs 实际项目数**：AutoScaler 只调整 `capacity`（允许的上限），不主动创建项目。实际项目数由 HTTP 请求驱动自然增长，项目数 ≤ capacity
- **内存压力驱动**：高内存压力时自动缩容（保留 1 个），低压力时放宽 capacity 上限
- **扩缩容冷却保护**：避免抖动，两次缩容之间至少间隔 `scaleCooldownSeconds` 秒（默认 30s）
- **Critical 立即响应**：当压力等级为 `critical` 时，冷却保护不适用，缩容立即执行（不等待冷却间隔）
- **空闲回收**：当有 2 个及以上项目时，`idleEvictMinutes` 分钟内无访问的项目自动退出并清理（默认 30 分钟）

### 2.2 平台差异化内存指标

#### macOS

**采集命令：** `memory_pressure`（首选） + `sysctl vm.swapusage`（辅助）

命令输出格式（Intel 与 Apple Silicon 字段完全一致）：

```
The system has 17179869184 (1048576 pages with a page size of 16384).

Stats:
Pages free:                     123456
Pages purgeable:                 78901
Pages purged:                    23456

Swap I/O:
Swapins:                             0
Swapouts:                            0

Page Q counts:
Pages active:                   456789
Pages inactive:                 234567
Pages speculative:               12345
Pages throttled:                     0
Pages wired down:               345678

Compressor Stats:
Pages used by compressor:        67890
Pages decompressed:              11111
Pages compressed:                22222

File I/O:
Pageins:                        987654
Pageouts:                            0

System-wide memory free percentage: 42%
```

**各段含义：**

| 字段 | 说明 |
|---|---|
| Pages free | 完全空闲、可立即使用的页 |
| Pages purgeable | 可清除的缓存页（系统需要时会自动回收） |
| Pages purged | 已被清除的缓存页累计数 |
| Swapins / Swapouts | Swap 换入/换出页数；归零说明无 Swap 压力 |
| Pages active | 正在被进程使用的页 |
| Pages inactive | 曾使用但暂时闲置，可被回收 |
| Pages speculative | 预读进来但尚未确认需要的页 |
| Pages wired down | 内核锁定、不可压缩不可 Swap 的页（系统关键数据） |
| Pages used by compressor | 被内存压缩器占用的物理页 |
| Pages compressed | 已被压缩的逻辑页数 |
| **System-wide memory free percentage** | **最关键指标**，iStat Menus 等工具也用此值 |

**Apple Silicon vs Intel 差异：**

| 差异点 | Intel Mac | Apple Silicon (M 系列) |
|---|---|---|
| **Page Size** | **4096 bytes (4 KB)** | **16384 bytes (16 KB)** |
| 输出格式 | 完全相同 | 完全相同 |
| Wired Memory 基线 | 较低 | 略高（驱动和内核结构差异） |
| Swap 起跳点 | ~30% 可用内存以下开始 swap | 同样约 30%（对应 Activity Monitor 黄/红分界线） |
| UMA 影响 | 无（dGPU 独立显存） | GPU 共享内存，图形密集型负载下压力攀升更快 |

page size 通过解析输出第一行的 `page size of <N>` 获取，脚本通用。

**压力判定：**

| 压力等级 | `memory_pressure` free% | Swap 条件 | 动作 |
|---|---|---|---|
| `low` | > 30% | — | 允许扩展 |
| `moderate` | 15% ~ 30% | — | 保持当前数量 |
| `high` | 8% ~ 15% | 或有 swap > 0 | 缩容 1 个 |
| `critical` | < 8% | 或 swap > 500MB | 缩至 1 个 |

**降级方案：** `memory_pressure` 命令不可用时，使用 Node.js `os.freemem()` / `os.totalmem()` 计算简单可用内存占比（精度略低，但始终可用）。

#### Windows

**采集策略：三级降级（优先高精度，逐级回退到 Node.js 兜底）**

> 注意：`wmic` 已被 Microsoft 标记为弃用（Windows 10 21H1+），不纳入采集方案。

**L1（首选）：Performance Counter**

```powershell
Get-Counter '\Memory\Available MBytes','\Memory\% Committed Bytes In Use'
```

实测输出（Windows 11 Pro, 32GB RAM）：

```
\memory\available mbytes        = 14957
\memory\% committed bytes in use = 28.9208017822636
```

- Available MBytes 包含 standby/cache 可回收内存，比 FreePhysicalMemory 更准确反映实际可用量
- Committed Bytes In Use 直接给出提交率百分比，无需计算
- 不需要管理员权限

**L2（备选）：CimInstance (WMI)**

```powershell
Get-CimInstance Win32_OperatingSystem |
  Select-Object FreePhysicalMemory,TotalVisibleMemorySize,
                FreeVirtualMemory,TotalVirtualMemorySize
```

实测输出（同一系统）：

```
FreePhysicalMemory     : 15591112  (KB)
TotalVisibleMemorySize : 33363376  (KB)
FreeVirtualMemory      : 59972048  (KB)
TotalVirtualMemorySize : 83695024  (KB)
```

换算后：

```
totalMB = 32581   (TotalVisibleMemorySize / 1024)
freeMB  = 14973   (FreePhysicalMemory / 1024)
commitUsedPercent = 28.9%   (1 - FreeVirtualMemory/TotalVirtualMemorySize)
```

- 始终可用（WMI 是 Windows 核心组件）
- 需要手动计算提交率
- 值单位为 KB

**L3（兜底）：Node.js `os`**

```javascript
os.freemem()  // 同一系统: ~14,943 MB
os.totalmem() // ~32,581 MB
```

实测输出：

```
totalMB=32581.42  freeMB=14943.68  usedPercent=54
```

- 零外部依赖，永不失败
- 无法获取提交率
- free 值略低于以上两种方式（Node.js 不包含 standby 可回收页）

**三级方法数值对比（同一时刻）：**

| 指标 | L1 PerfCounter | L2 CimInstance | L3 Node.js |
|---|---|---|---|
| 可用内存 | 14,957 MB | 14,973 MB (FreePhysical) | 14,943 MB |
| 总内存 | — | 32,581 MB | 32,581 MB |
| 提交率 | 28.9% | 28.9% | 不可用 |
| 可用占比 | — | — | 54% |

L1 的 Available MBytes 略高于 L2/L3 的 Free 值，因为 L1 包含了 standby 列表（可被系统立即回收的缓存页）。这对我们的缩容判断更有利——避免因"缓存占用看起来像内存不足"而过早缩容。

**Windows 压力判定（以 L1 Available MBytes 为准）：**

| 压力等级 | 可用物理内存 (Available MB) | 提交率 (Committed %) | 动作 |
|---|---|---|---|
| `low` | > 2048 MB | < 60% | 允许扩展 |
| `moderate` | 1024 ~ 2048 MB | 60% ~ 80% | 保持当前数量 |
| `high` | 512 ~ 1024 MB | 80% ~ 90% | 缩容 1 个 |
| `critical` | < 512 MB | > 90% | 缩至 1 个 |

> 阈值从原先的 1024/512/256 MB 调高到 2048/1024/512 MB，因为 Available MBytes 包含了可回收缓存，实际能立即分配的量更大。缩容触发保守一些，宁可早缩不可晚缩。

**L2/L3 降级阈值：**

L2 降级时用 FreePhysicalMemory（不含 standby），阈值下调：

| 压力等级 | FreePhysicalMemory |
|---|---|
| `low` | > 1536 MB |
| `moderate` | 768 ~ 1536 MB |
| `high` | 384 ~ 768 MB |
| `critical` | < 384 MB |

L3 兜底时用 `freemem/totalmem` 比例：

| 等级 | 条件 |
|---|---|
| `low` | free% > 35% |
| `moderate` | 20% ~ 35% |
| `high` | 10% ~ 20% |
| `critical` | < 10% |

### 2.3 内存监控失效时的降级模式

#### 2.3.1 快照采集与降级机制

MemoryMonitor 后台每 `checkIntervalSeconds`（默认 15s）采集一次系统内存快照。降级机制处理两类异常：

**A. 采集失败降级**

当单次采集失败时（L1 → L2 → L3 三级全部失败），该周期的 `getLatestSnapshot()` 返回 `null`。连续失败计数递增。AutoScaler 仍然使用上一个成功的快照做决策，直到快照过期或连续失败达到阈值。

| 状态 | 条件 | 行为 |
|---|---|---|
| 正常 | 最近一次采集成功 | 使用最新快照 |
| 快照过期 | `Date.now() - snapshot.timestamp > maxSnapshotAgeMs`（默认 60s） | 触发强制同步采集；若强制采集也失败 → 本轮 pressureLevel = `unknown`，跳过内存驱动决策 |
| 连续失败 | 连续 5 个采集周期失败 | 进入降级模式（degraded = true） |

**B. 采集恢复（自愈）**

降级模式下每个采集周期仍然尝试 L1 → L2 → L3 完整链路。**任一级别采集成功即退出降级模式**，连续失败计数清零，恢复完整功能。不做指数退避——采集本身依赖外部命令，间隔过长无益。

#### 2.3.2 采集失败定义

一次采集被视为"失败"的判定：

| 失败类型 | 判定条件 |
|---|---|
| 命令不存在 | 子进程返回 `ENOENT` 或 exit code 127 |
| 权限拒绝 | 子进程返回 `EACCES` / `EPERM` |
| 超时 | 命令执行超过 `collectionTimeoutMs`（默认 10s）无响应 |
| 解析失败 | 输出格式不匹配预期正则，且无法提取任何有效字段 |

#### 2.3.3 降级模式运行时行为

当所有平台内存采集方案均失效时（三级降级全部失败，极端情况下可能发生），AutoScaler 的内存驱动决策不可用，此时进入**降级模式**：

- **保留容量上限**：按 `maxProjects`（默认 3）作为 capacity，LRU 淘汰正常运作
- **保留空闲回收**：≥ 2 个项目时，`idleEvictMinutes` 分钟无访问的项目正常退出清理
- **暂停内存驱动**：不再因内存压力触发缩容/扩容，压力等级报告为 `unknown`

降级模式在 `/status` 中体现：

```json
"memory": {
  "platform": "win32",
  "pressureLevel": "unknown",
  "source": "none",
  "degraded": true,
  "reason": "All memory collection methods failed"
},
"autoScaling": {
  "enabled": true,
  "degraded": true,
  "currentProjectCount": 2,
  "capacity": 2,
  "maxProjects": 3
}
```

> 降级模式是自愈的：下一次采集周期若任一采集方案恢复可用，自动退出降级，恢复完整功能。

### 2.4 健康状态增强

- **不设索引完成超时**：不做硬性等待，不设超时假设
- **进度完全透明**：`/status` 返回每个项目当前的 LSP `$/progress` 实时进度
- **索引进度活性检测**：若 `lastUpdated` 超过 10 分钟且 stage 仍为 `in_progress`，自动标记为 `stalled`（JDT LS 索引线程可能已静默崩溃），而非持续展示 in_progress
- **Ready 语义保持**：ready = LSP 连接已建立（同步维持现有行为），索引进度通过独立字段暴露
- **内存指标暴露**：`/status` 同时返回当前内存压力快照 + 自动伸缩状态
- **进程级内存暴露**：`/status` 返回每个项目对应 JDT LS 进程的 RSS（物理内存占用），供诊断使用
- **查询响应完整性标记**：所有 LSP 查询端点（`/definition`、`/references`、`/symbols`、`/workspace-symbols` 等）在响应 metadata 中附带 `indexingComplete: boolean` 标记。当索引进度 < 100% 时设为 `false`，调用方可据此判断查询结果可能不完整，无需单独轮询 `/status`

### 2.5 守护进程空闲超时与自动伸缩的交互

守护进程级 `idleTimeoutMinutes` 与项目级 `idleEvictMinutes` 是两个独立机制，需明确定义交互边界：

| 条件 | 守护进程行为 |
|---|---|
| 池中项目数 ≥ 1（含仅剩 1 个 idle 项目） | 守护进程**视为活跃**，`idleTimeoutMinutes` 不触发 |
| 池中项目数 = 0（所有项目已被 idle-evict 或手动 release） | 从最后一个项目退出时开始计时，超过 `idleTimeoutMinutes` 无新请求则守护进程退出 |
| 池中项目数 = 0 但在 idleTimeoutMinutes 内有新请求到达 | 重置 idle 计时器，按需创建新项目 |

核心原则：**只要池中还有项目（无论其内部 idle 状态如何），守护进程就不退出。** 项目级空闲回收由 AutoScaler 的 `idleEvictMinutes` 专职负责，守护进程级 `idleTimeoutMinutes` 仅在池完全清空后生效。

### 2.6 进程级内存追踪

除了系统级内存快照外，追踪每个项目对应的 JDT LS 进程的实际物理内存占用（RSS），为 `/status` 和缩容决策提供更精准的数据。

**采集方式（按平台）：**

| 平台 | 命令 | 字段 | 单位 |
|---|---|---|---|
| macOS | `ps -p <pid> -o rss=` | RSS | KB |
| Windows | `powershell "(Get-Process -Id <pid>).WorkingSet64"` | WorkingSet64 | bytes |
| 降级方案 | Node.js `process.memoryUsage().rss` 仅适用于守护进程自身 | — | — |

**数据结构：**

```typescript
interface ProjectMemorySnapshot {
  projectPath: string;
  pid: number;              // JDT LS 子进程 PID
  rssMB: number;            // 物理内存占用 (MB)
  heapUsedMB?: number;      // JVM 堆使用量 (MB)，如果 JMX 可用
  heapTotalMB?: number;     // JVM 堆总量 (MB)，如果 JMX 可用
  timestamp: number;
}
```

> JMX（Java Management Extensions）可提供更细粒度的堆使用信息，但需要额外配置 JMX 端口，会增加复杂度。Phase 1 仅通过 RSS 实现，JMX 作为未来扩展方向。

**获取子进程 PID：** 在 `JdtLsClient` 启动 JDT LS 时记录 `childProcess.pid`，通过 `DaemonStateManager` 暴露给 MemoryMonitor 使用。

---

## 3. 架构设计

### 3.1 新增模块总览

```
src/
├── daemon/
│   ├── core/
│   │   ├── daemonStateManager.ts  (扩展：多项目进度追踪、内存状态缓存)
│   │   └── memoryMonitor.ts       [新增] 平台内存监控
│   ├── services/
│   │   ├── projectService.ts      (扩展：监听 $/progress，更新索引状态)
│   │   └── autoScaler.ts          [新增] 自动扩缩容决策 + 空闲回收
│   └── routes/
│       └── routeHandlers.ts       (扩展：/status 返回内存/伸缩/索引进度)
└── jdt/
    └── launcher.ts                (修复：添加 -Djava.awt.headless=true)
```

### 3.2 模块职责

#### MemoryMonitor（`src/daemon/core/memoryMonitor.ts`）

```typescript
interface MemorySnapshot {
  platform: 'darwin' | 'win32' | 'linux';
  timestamp: number;
  // 通用字段
  totalMB: number;
  freeMB: number;             // 可用/空闲内存 (MB)
  usedPercent: number;        // 使用率 0-100
  // macOS 专用
  pageSize?: number;          // 4096 (Intel) 或 16384 (Apple Silicon)
  swapUsedMB?: number;        // swap 使用量 (MB)，来自 sysctl vm.swapusage
  memoryPressureFreePercent?: number;  // "System-wide memory free percentage" (0-100)
  // Windows 专用
  availableMB?: number;       // L1 Performance Counter Available MBytes
  commitPercent?: number;     // 提交率 (0-100)，L1 来自 PerfCounter，L2 来自计算
  // 采集来源
  source: 'memory_pressure' | 'perf_counter' | 'cim_instance' | 'node_os';
  // 采集元数据
  collectionDurationMs?: number;  // 本次采集耗时
  error?: string;                 // 若本次采集失败，记录失败原因
}

type PressureLevel = 'low' | 'moderate' | 'high' | 'critical' | 'unknown';

class MemoryMonitor {
  static isMacOS(): boolean
  static isWindows(): boolean

  // 采集当前内存快照（平台自动检测，走 L1→L2→L3 降级链路）
  async getMemorySnapshot(): Promise<MemorySnapshot>

  // 启动/停止定时采集（默认每 15s）
  start(intervalMs?: number): void
  stop(): void

  // 获取最近一次成功快照（同步，无 I/O）
  // 若从未采集成功过，返回 null
  getLatestSnapshot(): MemorySnapshot | null

  // 获取连续采集失败次数（供 AutoScaler 判断降级）
  getConsecutiveFailures(): number

  // 判断当前压力等级（基于 getLatestSnapshot()）
  // 若快照为 null 或过期，返回 'unknown'
  getPressureLevel(): PressureLevel

  // 快照是否过期（超过 maxSnapshotAgeMs，默认 60s）
  isSnapshotStale(): boolean

  // ========== 进程级内存 ==========

  // 采集指定 PID 的 JDT LS 进程 RSS
  async getProcessMemory(pid: number): Promise<ProjectMemorySnapshot>

  // 批量采集所有活跃项目进程的 RSS
  async getAllProcessMemory(): Promise<ProjectMemorySnapshot[]>
}
```

**字段说明：**

| 字段 | 说明 |
|---|---|
| `collectionDurationMs` | 本次采集从发起命令到解析完成的耗时，用于监控采集性能 |
| `error` | 仅当**最终降级方案也失败**时写入（如 L3 Node.js `os.freemem()` 都失败），正常降级到 L3 不算失败 |
| `getConsecutiveFailures()` | 返回连续完全失败的周期数。一旦有一轮采集成功（含降级到 L3），计数器归零 |
| `isSnapshotStale()` | 判定 `Date.now() - snapshot.timestamp > 60_000`，AutoScaler 据此触发强制刷新 |

**macOS 采集流程：**

1. 执行 `memory_pressure` 命令，解析输出
   - 从第一行提取 `page size of <N>` → `pageSize`
   - 解析 `Pages free/Purgeable/Active/Inactive/Wired down` 等段
   - 解析 `Swapouts`（>0 表示有 swap 压力）
   - 解析最后一行 `System-wide memory free percentage: <N>%` → `memoryPressureFreePercent`
2. 执行 `sysctl vm.swapusage` 获取精确 swap 使用量（MB）
3. 根据 `memoryPressureFreePercent` 和 swap 判定压力等级
4. 若 `memory_pressure` 不可用，降级到 Node.js `os.freemem()` / `os.totalmem()`

**Windows 采集流程：**

1. L1：执行 PowerShell `Get-Counter '\Memory\Available MBytes','\Memory\% Committed Bytes In Use'` 获取 Available MBytes 和提交率
2. L2：若 L1 失败，执行 PowerShell `Get-CimInstance Win32_OperatingSystem` 获取 `FreePhysicalMemory`、`TotalVisibleMemorySize`、`FreeVirtualMemory`、`TotalVirtualMemorySize`，计算可用内存和提交率
3. L3：若 L1/L2 均失败，降级到 Node.js `os.freemem()` / `os.totalmem()`
4. 记录 `source` 字段表示本次采集来源（`'perf_counter'` / `'cim_instance'` / `'node_os'`）
5. 若 L1/L2/L3 全部失败（极端情况），在 `error` 字段写入失败原因，本次快照的 `timestamp` 仍记录，供后续诊断

**通用设计原则：**
- `getLatestSnapshot()` 同步返回缓存值，永不阻塞
- 后台定时采集，采集失败不影响主流程
- 每次采集都记录 `timestamp`，AutoScaler 可据此判断数据新鲜度

#### AutoScaler（`src/daemon/services/autoScaler.ts`）

```typescript
interface ScaleAction {
  action: 'relax_capacity' | 'shrink' | 'evict_idle' | 'none';
  reason: string;
  targetProject?: string;  // 被淘汰的项目路径
}

interface ScaleDecision {
  timestamp: number;
  degraded: boolean;              // 是否处于降级模式
  degradedReason?: string;        // 降级原因
  currentCount: number;
  capacity: number;               // 当前允许的最大项目数（由内存压力决定）
  pressureLevel: PressureLevel | 'unknown';
  action: ScaleAction;
  snapshotAgeMs?: number;         // 使用的快照寿命（毫秒），用于评估决策新鲜度
  snapshotStale?: boolean;        // 快照是否已过期
}

class AutoScaler {
  constructor(memoryMonitor: MemoryMonitor, projectPool: ProjectPool, config: DaemonConfig)

  // 启动/停止定时检查（默认每 15s）
  start(intervalMs?: number): void
  stop(): void

  // 执行一次扩缩容评估
  async evaluate(): Promise<ScaleDecision>

  // 获取最近一次决策
  getLatestDecision(): ScaleDecision | null

  // 是否启用
  get enabled(): boolean
}
```

**决策逻辑：**

```
第一步：检查内存监控状态 + 快照时效性
  snapshot = memoryMonitor.getLatestSnapshot()
  consecutiveFailures = memoryMonitor.getConsecutiveFailures()

  if snapshot is null:
    consecutiveFailures++
    if consecutiveFailures >= 5:
      → 进入降级模式 (degraded = true)
    → 使用上一个有效快照（若有），否则 pressureLevel = 'unknown'
  else:
    consecutiveFailures = 0
    若之前在降级模式 → 退出降级，恢复正常
    snapshotAge = Date.now() - snapshot.timestamp
    if snapshotAge > maxSnapshotAgeMs (默认 60s):
      → 快照过期，触发一次强制同步采集
      if 强制采集成功:
        → 使用新快照
      else:
        → 本轮标记 snapshotStale = true
        → pressureLevel = 'unknown'
        → 跳过内存驱动决策（仅执行空闲回收 + 容量上限检查）
    else:
      → 快照新鲜，正常决策

第二步：空闲回收（降级和正常模式均执行）
  条件: projectPool.size >= 2
  遍历所有项目:
    if lastAccess > idleEvictMinutes 分钟:
      → 标记 draining，执行缩容流程（见第六步）
    if 项目当前有活跃查询请求（见 3.2.1 并发安全）:
      → 排除该候选，选择下一个项目

第三步：内存压力评估（仅正常模式，且快照新鲜）
  pressure = memoryMonitor.getPressureLevel()
  if pressure === 'unknown':
    → capacity 保持不变（不因过期数据做错误决策）

  pressure === 'low'      → capacity = min(currentCapacity + 1, effectiveMaxProjects)
  pressure === 'moderate' → capacity = currentCapacity (不变)
  pressure === 'high'     → capacity = max(currentCapacity - 1, 1)
  pressure === 'critical' → capacity = 1

第四步：容量上限检查（降级和正常模式均执行）
  若 projectPool.size > capacity:
    超出数量 = projectPool.size - capacity
    按 LRU（低优先级 + 最久未访问）依次标记 draining，触发缩容
  若 capacity > projectPool.size:
    → 仅更新 capacity（relax_capacity），不主动加载项目
    → 实际项目数由后续 HTTP 请求触发 lazy init 自然增长

第五步：冷却保护（critical 压力豁免）
  if pressureLevel !== 'critical':
    if 距上次缩容操作 < scaleCooldownSeconds:
      → 跳过本轮缩容执行（但保留 capacity 计算结果，供 /status 展示）
  else:
    → critical 压力，立即执行，不检查冷却时间

第六步：执行 — 缩容（带 drain 机制）
  缩容流程（每次最多释放 1 个，避免并发释放造成资源风暴）:
    1. 选中目标项目（最低优先级 + 最久未访问，且未标记 draining）
    2. 设置 pc.draining = true，阻止新请求路由到该项目
    3. 轮询等待 pc.activeRequests === 0（每 200ms，最长 5s 超时）
    4. 若 5s 内 activeRequests 归零 → 正常释放
    5. 若超时 → 记录 warning，强制释放（in-flight 请求将收到错误）
    6. projectPool.releaseProject(projectPath)
    7. 若池中只剩 1 个项目且 pressure = critical:
       → 不释放，记录 "minProjects protection" 到 warnings

  扩容流程:
    仅更新 capacity 值，不做任何项目加载
    action 标记为 'relax_capacity'（而非 'expand'）
```

**effectiveMaxProjects 计算：**

```
若用户在 config.daemon.maxProjects 显式设置了值 > 3:
  effectiveMaxProjects = config.daemon.maxProjects  (信任用户配置)
否则:
  effectiveMaxProjects = 3  (默认上限)
```

即：即使用户设置 `maxProjects: 5`，AutoScaler 也会在内存充裕时扩展到 5。但默认情况下上限为 3。

#### 3.2.1 并发安全：AutoScaler 与 HTTP 请求隔离

AutoScaler 的 `evaluate()` 与 HTTP 请求路由处理共享同一个 `ProjectPool.clients` Map。为防止缩容期间新请求被路由到即将释放的项目，引入轻量级 draining 机制：

**ProjectClient 新增字段：**

```typescript
interface ProjectClient {
  // ... 现有字段
  draining: boolean;        // 标记为待释放，拒绝新请求
  activeRequests: number;   // 当前 in-flight 的 LSP 请求数
}
```

**交互流程：**

```
HTTP 请求到达
  → routeHandlers.setupRequestRouter()
  → initClient() → projectPool.getClient()
    → 检查 pc.draining
      if true: 返回错误 "project is being evicted, please retry"（调用方应重试）
    → 否则: 返回 client，调用方执行 LSP 操作
      → 操作前: pc.activeRequests++
      → 操作后 (finally): pc.activeRequests--

AutoScaler 缩容
  → 选中目标项目
  → pc.draining = true  （此后新请求不会被路由到该项目）
  → 等待 pc.activeRequests === 0（max 5s）
  → releaseProject()
```

**设计要点：**
- 不使用外部锁库，仅靠 `draining` 布尔标记 + `activeRequests` 计数器，零依赖
- `activeRequests` 的递增/递减是同步的，Node.js 单线程事件循环天然保证原子性（无竞态）
- draining 标记设置后，`getClient()` 在同一事件循环 tick 内即可感知，延迟为零
- 5s 超时被突破的概率极低（正常 LSP 请求在 2s 内完成），即使超时强制释放，调用方也会收到明确的错误响应并重试
- 若调用方未重试：下一条请求到达时 `initClient()` 会触发 lazy re-init（冷启动），路径通畅

#### 索引进度追踪（扩展 projectService.ts 和 daemonStateManager.ts）

JDT LS 在初始化完成后的后台索引期间会通过 LSP `$/progress` 通知报告进度。

**LSP Progress 通知格式（JDT LS）：**

```json
{
  "jsonrpc": "2.0",
  "method": "$/progress",
  "params": {
    "token": "build",
    "value": {
      "kind": "begin",
      "title": "Building workspace",
      "message": "Building workspace (0%)",
      "percentage": 0
    }
  }
}
```

```
// 进度更新
{ "kind": "report", "message": "Building workspace (58%)", "percentage": 58 }

// 索引结束
{ "kind": "end", "message": "Building workspace (100%)" }
```

**实现方案：**

1. 在 `DaemonStateManager` 中维护 `Map<string, IndexProgress>`，key 为 projectPath：

```typescript
interface IndexProgress {
  stage: 'not_started' | 'in_progress' | 'completed' | 'stalled';
  title?: string;          // "Building workspace" / "Importing projects"
  percent?: number;        // 0-100
  message?: string;        // 进度消息原文
  lastUpdated: number;     // 最后更新时间
}
```

**活性检测：** 若 `stage === 'in_progress'` 且 `Date.now() - lastUpdated > 10 * 60 * 1000`（10 分钟无新的 progress 通知），自动将 stage 翻转为 `stalled`。这意味着 JDT LS 可能已停止发送进度（索引线程静默崩溃/Hang）。stalled 与 in_progress 在 `/status` 中明确区分，调用方可据此判断是否需要重启项目。

2. 在 `LspConnectionManager` 中拦截 `$/progress` 通知，通过回调传递给 `DaemonStateManager`
3. `/status` 端点返回每个项目的 `indexProgress` 字段（不做超时假设）
4. 所有 LSP 查询端点在响应 `metadata` 中附带 `indexingComplete: boolean`：
   - 若当前项目的 `indexProgress.percent === 100` 或 `stage === 'completed'` → `true`
   - 否则 → `false`
   - 调用方可据此判断查询结果是否完整，无需单独轮询 `/status`

### 3.3 JVM 修复：macOS "未响应" 问题

**问题根因：**

macOS 上 JVM 进程默认会初始化 AWT（Abstract Window Toolkit），尝试连接 Cocoa 窗口服务器。若进程不 pump 事件循环（headless 服务就是这种情况），macOS 会判定该进程"Not Responding"并在 Activity Monitor 中标记为红色。

**修复：** 在 `JdtLauncher.buildJvmArgs()` 中添加 `-Djava.awt.headless=true`。

当前 `buildJvmArgs()` 位于 `src/jdt/launcher.ts:55`，追加一行即可：

```typescript
buildJvmArgs(): string[] {
  const args: string[] = [];
  // 新增：macOS 无头模式，防止进程被标记为"未响应"
  args.push('-Djava.awt.headless=true');
  // ... 其余现有逻辑不变
}
```

注意此参数应放在 `-Xms`/`-Xmx` 之前（系统属性通常先于内存参数）。

**效果：**
- JDT LS 不再尝试初始化 AWT/Cocoa 工具包
- macOS Activity Monitor 中不再显示"未响应"
- 跨平台安全：Windows/Linux 上 `-Djava.awt.headless` 同样有效，无副作用

### 3.4 配置扩展

在 `DaemonConfigOptions`（`src/core/types.ts`）中修改：

```typescript
interface DaemonConfigOptions {
  port: number;
  idleTimeoutMinutes: number;
  maxProjects: number;          // 现有字段，默认 1
  perProjectMemory: string;

  // 新增字段
  autoScaling?: {
    enabled: boolean;              // 默认 true
    minProjects: number;           // 默认 1
    maxProjects: number;           // 默认 3
    scaleCooldownSeconds: number;  // 默认 30
    checkIntervalSeconds: number;  // 默认 15
    idleEvictMinutes: number;      // 空闲回收时间，默认 30
    maxSnapshotAgeMs: number;      // 快照最大寿命（毫秒），默认 60000 (60s)
    drainTimeoutMs: number;        // 缩容 drain 超时（毫秒），默认 5000 (5s)
    collectionTimeoutMs: number;   // 单次内存采集超时（毫秒），默认 10000 (10s)
    memoryThresholds?: {
      macOS?: {
        lowFreePercent: number;       // 默认 30
        highFreePercent: number;      // 默认 15
        criticalFreePercent: number;  // 默认 8
        maxSwapMB: number;            // 默认 500
      };
      windows?: {
        lowFreeMB: number;            // 默认 2048
        highFreeMB: number;           // 默认 1024
        criticalFreeMB: number;       // 默认 512
        maxCommitPercent: number;     // 默认 80
        criticalCommitPercent: number; // 默认 90
      };
    };
  };
}
```

**向后兼容设计：**

- `autoScaling.enabled` 默认 `true`
- 当 `maxProjects === 1` 时，自动伸缩即使 enabled 也不会生效（池大小锁死为 1）
- 用户显式设置 `autoScaling.enabled: false` 可关闭自动伸缩，回退到现有的固定 `maxProjects` 模式
- 不配置 `autoScaling` 块时使用上述所有默认值

### 3.5 `/status` 端点扩展

响应新增 `memory`、`autoScaling` 和索引进度字段：

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "progress": null,

    "project": {
      "path": "/path/to/project",
      "status": "ready",
      "loadTime": 12345,
      "lastAccess": 1715600000000,
      "priority": 0,
      "indexProgress": {
        "stage": "completed",
        "percent": 100
      }
    },

    "projects": [
      {
        "path": "/path/to/project1",
        "status": "ready",
        "loadTime": 12000,
        "lastAccess": 1715600000000,
        "priority": 0,
        "indexProgress": { "stage": "completed", "percent": 100 },
        "processMemory": {
          "pid": 12346,
          "rssMB": 1850,
          "timestamp": 1715600000000
        }
      },
      {
        "path": "/path/to/project2",
        "status": "ready",
        "loadTime": 8900,
        "lastAccess": 1715600001000,
        "priority": 0,
        "indexProgress": {
          "stage": "in_progress",
          "title": "Building workspace",
          "percent": 58,
          "message": "Building workspace (58%)"
        },
        "processMemory": {
          "pid": 12347,
          "rssMB": 1420,
          "timestamp": 1715600000000
        }
      }
    ],

    "memory": {
      "platform": "win32",
      "pressureLevel": "low",
      "source": "perf_counter",
      "snapshotAgeMs": 3200,
      "snapshotStale": false,
      "snapshot": {
        "totalMB": 32581,
        "freeMB": 14957,
        "usedPercent": 54,
        "availableMB": 14957,
        "commitPercent": 28.9,
        "collectionDurationMs": 450
      },
      "consecutiveFailures": 0
    },

    "autoScaling": {
      "enabled": true,
      "currentProjectCount": 2,
      "capacity": 3,
      "maxProjects": 3,
      "lastScaleAction": { "action": "relax_capacity", "reason": "压力降低，放宽容量上限" },
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

### 3.6 CLI 命令扩展

```
# 查看详细状态（含内存、索引进度、自动伸缩信息）
jls daemon status --verbose

# 查看内存快照
jls daemon memory

# 热更新自动伸缩配置
jls daemon config --auto-scaling enabled=false
```

---

## 4. 推演与风险

### 4.1 可完成程度评估

| 功能 | 复杂度 | 风险 | 评估 |
|---|---|---|---|---|
| 内存监控失效降级 | 低 | 所有采集方案全失效概率极低，但需兜底 | 可行 |
|---|---|---|---|
| macOS MemoryMonitor | 中 | `memory_pressure` 解析格式稳定（Intel/AS 字段一致），仅 page size 不同需动态解析 | 可行 |
| Windows MemoryMonitor | 中 | wmic 在 Windows Server Core 可能缺失，L2 PowerShell / L3 Node.js 兜底保证可用 | 可行 |
| AutoScaler 决策引擎 | 低 | 纯逻辑，无 I/O | 可行 |
| 空闲回收 | 低 | ProjectPool 已有 LRU 淘汰和 `releaseProject`，复用即可 | 可行 |
| 索引进度追踪 | 中 | 依赖 JDT LS `$/progress` 格式，不同版本 token/title 可能有差异，需模糊匹配 | 可行 |
| `/status` + CLI 扩展 | 低 | 纯数据组装 | 可行 |
| `-Djava.awt.headless=true` 修复 | 极低 | 一行追加，跨平台安全 | 可行 |
| 配置向后兼容 | 低 | 新增可选字段，无破坏性变更 | 可行 |

### 4.2 关键风险与缓解

1. **JDT LS `$/progress` 格式变化**
   - 风险：不同 JDT LS 版本的 progress token 和 message 格式可能不同
   - 缓解：模糊匹配 title/message（包含 "build" / "index" / "import" / "workspace" 关键字），不依赖固定 token
   - 若完全收不到 progress 通知，索引进度保持为 `not_started`，不影响核心功能

2. **多项目索引并行导致内存峰值**
   - 风险：两个项目同时处于 indexing 阶段，内存压力瞬间飙高
   - 缓解：扩容是 lazy 的（不预初始化），自然错峰；AutoScaler 在 moderate 及以上压力时不扩容

3. **`memory_pressure` 解析正则失效**
   - 风险：macOS 大版本更新可能调整输出格式
   - 缓解：同时采集 `sysctl vm.swapusage` 做交叉验证；降级到 Node.js `os` 兜底

4. **Windows Performance Counter 可能被禁用**
   - 风险：部分 Windows Server Core 或精简版可能未启用性能计数器
   - 缓解：L1 (PerfCounter) → L2 (CimInstance) → L3 (Node.js) 三级降级，最终 Node.js `os.freemem()` 始终可用

5. **空闲回收误杀**
   - 风险：用户长时间未访问但后续仍需使用的项目被回收
   - 缓解：回收后下次访问会自动重建（lazy init），代价是一次冷启动延迟；30 分钟阈值可配置

---

## 5. 实现计划

### Phase 1：JVM 修复 + 内存监控
- `src/jdt/launcher.ts`：添加 `-Djava.awt.headless=true`
- `src/daemon/core/memoryMonitor.ts`：macOS + Windows 完整实现
- `src/core/types.ts`：`MemorySnapshot`、`PressureLevel` 类型定义

### Phase 2：自动伸缩 + 空闲回收
- `src/daemon/services/autoScaler.ts`：决策引擎（含 capacity 模型、critical 冷却豁免、drain 缩容机制）+ 空闲回收
- `src/projectPool.ts`：新增 `draining` / `activeRequests` 字段，支持并发安全缩容
- `src/jdt/configLoader.ts`：`autoScaling` 默认配置
- `src/daemon.ts`：集成 `MemoryMonitor` 和 `AutoScaler` 到启动流程，守护进程空闲超时与 auto-scaling 交互
- `src/core/types.ts`：`DaemonConfigOptions.autoScaling` 类型扩展（含 `maxSnapshotAgeMs`、`drainTimeoutMs`、`collectionTimeoutMs`）

### Phase 3：索引进度追踪
- `src/jdt/lspConnection.ts`：拦截 `$/progress` 通知
- `src/daemon/core/daemonStateManager.ts`：维护 `IndexProgress` 状态
- `src/daemon/services/projectService.ts`：绑定 progress 回调到状态管理器

### Phase 4：端点与 CLI 扩展
- `src/daemon/routes/routeHandlers.ts`：`/status` 返回 memory + autoScaling + indexProgress
- `src/cli/commands/daemon.ts`：新增 `jls daemon memory` 子命令、`status --verbose`

### Phase 5：测试与验证
- 单元测试：`memory_pressure` / `wmic` 输出解析
- 单元测试：AutoScaler 决策矩阵（mock MemoryMonitor）
- 手动测试：macOS Intel / Apple Silicon 实机
- 手动测试：Windows 10/11 实机
- 验证：macOS Activity Monitor 中 JDT LS 不再显示"未响应"
