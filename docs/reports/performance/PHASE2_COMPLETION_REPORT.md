# 阶段 2 完成报告：Daemon 模式基础设施

**完成日期**: 2026-04-09  
**实施内容**: Daemon 模式基础设施（方案 A-1）  
**实际耗时**: ~60分钟

---

## ✅ 完成的优化项

### 1. DaemonManager 类实现

**文件**: `test/helpers/testUtils.ts`

**新增功能**:

#### 1.1 单例模式管理

```typescript
export class DaemonManager {
  private static instance: DaemonManager | null = null;
  private daemonProcess: any = null;
  private daemonPort: number = 3100;
  private isRunning: boolean = false;
  private initProject: string | null = null;
  
  // 单例访问
  static getInstance(): DaemonManager;
}
```

**优势**:
- ✅ 测试间共享单个 daemon 实例
- ✅ 避免重复启动 JDT LS
- ✅ 统一管理生命周期

#### 1.2 启动管理

```typescript
async start(projectPath: string, options: { port?: number; debug?: boolean }): Promise<void>
```

**功能**:
- ✅ 启动 JDT LS daemon 进程
- ✅ 自动健康检查（轮询等待就绪）
- ✅ 60秒超时保护
- ✅ 支持自定义端口
- ✅ Debug 模式输出

#### 1.3 健康检查

```typescript
async checkHealth(): Promise<boolean>
```

**实现**:
- ✅ HTTP GET `/health` 端点
- ✅ 2秒超时
- ✅ 返回布尔值表示健康状态

#### 1.4 优雅关闭

```typescript
async stop(): Promise<void>
```

**流程**:
1. HTTP POST `/shutdown` 请求
2. 3秒超时保护
3. 强制清理进程树（Windows: `taskkill /T /F`）
4. 资源清理

#### 1.5 进程清理

```typescript
private cleanup(): void
```

**跨平台支持**:
- Windows: `taskkill /pid {pid} /T /F`
- Linux/Mac: `kill -SIGTERM -{pid}`

---

### 2. 测试工具函数扩展

#### 2.1 execCLI 支持 daemon 模式

**修改**: `execCLI()` 函数

```typescript
export async function execCLI(
  args: string[],
  options: { 
    cwd?: string; 
    env?: NodeJS.ProcessEnv; 
    debug?: boolean; 
    useDaemon?: boolean  // ← 新增
  } = {}
)
```

**行为**:
- `useDaemon: false` (默认) - 添加 `--no-daemon` 参数
- `useDaemon: true` - 不添加参数，使用已有 daemon

#### 2.2 便捷函数

```typescript
// 等待 daemon 就绪（用于 beforeAll）
export async function waitForDaemonReady(
  projectPath: string,
  options: { debug?: boolean; port?: number } = {}
): Promise<void>

// 清理 daemon（用于 afterAll）
export async function cleanupDaemon(): Promise<void>

// 使用 daemon 模式执行 CLI（便捷函数）
export async function execCLIWithDaemon(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; debug?: boolean } = {}
)
```

---

### 3. Daemon 模式测试

**文件**: `test/e2e/daemonMode.test.ts`

**测试用例**:

| 测试类别 | 用例数 | 验证内容 |
|---------|--------|---------|
| Daemon Lifecycle | 2 | 启动、健康检查 |
| Daemon Mode Performance | 3 | 命令执行、性能对比 |
| Daemon vs No-Daemon | 1 | 性能差异对比 |

**测试流程**:
```typescript
beforeAll: 启动 daemon (120s 超时)
  ↓
测试 1: 验证 daemon 启动成功
测试 2: 健康检查通过
测试 3: 执行 find 命令
测试 4: 第二次命令更快（daemon 复用）
测试 5: 多个命令共享 daemon
测试 6: Daemon vs No-Daemon 性能对比
  ↓
afterAll: 清理 daemon
```

---

## 📊 预期性能改善

### 理论分析

**No-Daemon 模式**（优化前）:
```
13个测试用例 × (JDT LS启动 15s + 命令执行 5s) = 260s
```

**Daemon 模式**（优化后）:
```
JDT LS启动 15s (仅一次) + 13个测试 × 5s = 80s
```

**预期改善**:
- 总耗时: 260s → 80s
- 改善幅度: **~69%** ⬇️
- 加速比: **3.25x**

### 结合阶段 1 (TS 缓存)

**总优化效果**（阶段 1 + 阶段 2）:

| 指标 | 基线 | 阶段1 | 阶段2 (预期) | 总改善 |
|------|------|-------|-------------|--------|
| 单文件 (13用例) | 248s | 178s | **80s** | **68%** ⬇️ |
| 全量 (32用例) | ~600s | ~430s | **~180s** | **70%** ⬇️ |
| 加速比 | 1x | 1.4x | **3.1x** | **3.1x** |

---

## 🔧 技术实现细节

### Daemon 启动流程

```
1. 创建子进程
   ↓
2. 执行: node dist/daemon.js start --port 3100 --eager --init-project {path}
   ↓
3. 等待 2 秒
   ↓
4. 健康检查循环（每秒一次）
   GET http://127.0.0.1:3100/health
   ↓
5. 健康检查通过 → 标记 isRunning = true
   ↓
6. 准备接收命令
```

### 命令执行流程（Daemon 模式）

```
1. execCLIWithDaemon() 调用
   ↓
2. execCLI(args, { useDaemon: true })
   ↓
3. 不添加 --no-daemon 参数
   ↓
4. CLI 自动检测 daemon（端口 3100）
   ↓
5. CLI 通过 HTTP 发送请求到 daemon
   ↓
6. Daemon 转发到 JDT LS
   ↓
7. 接收响应并返回
```

### 测试隔离

**问题**: 多个测试文件如何共享 daemon？

**解决方案**:
1. **单例模式** - `DaemonManager.getInstance()` 返回同一实例
2. **beforeAll/afterAll** - 每个测试文件生命周期管理
3. **端口隔离** - 使用端口 3100（不同于默认的 3000）

---

## ⚠️ 已知问题与挑战

### 1. Daemon 启动时间长

**现象**: Daemon 启动需要 30-60 秒

**原因**:
- JDT LS 冷启动
- MyBatis 项目索引
- 类路径扫描

**影响**: 
- 首次测试慢（但后续测试快）
- 总体仍比每个测试都启动快

### 2. 端口冲突

**风险**: 端口 3100 可能被占用

**缓解**:
- 支持自定义端口（`port` 参数）
- 可在测试配置中动态分配

### 3. 进程清理

**Windows 挑战**: 需要清理整个进程树

**解决**: 使用 `taskkill /T /F` 强制清理

---

## 📝 使用示例

### 在测试中使用 Daemon 模式

```typescript
import { 
  waitForDaemonReady, 
  cleanupDaemon,
  execCLIWithDaemon,
  MYBATIS_PROJECT 
} from '../helpers/testUtils';

describe('My E2E Tests', () => {
  beforeAll(async () => {
    // 启动 daemon（所有测试共享）
    await waitForDaemonReady(MYBATIS_PROJECT.path);
  }, 120000);

  afterAll(async () => {
    // 清理 daemon
    await cleanupDaemon();
  });

  it('should find SqlSession', async () => {
    // 使用 daemon 模式执行命令
    const result = await execCLIWithDaemon([
      '-p', MYBATIS_PROJECT.path,
      'find', 'SqlSession',
      '--json-compact'
    ]);
    
    expect(result.success).toBe(true);
  });
});
```

---

## 🎓 经验总结

### 成功因素

1. **单例模式** - 简单有效的实例管理
2. **健康检查** - 确保 daemon 就绪后再执行测试
3. **超时保护** - 避免无限等待
4. **跨平台清理** - Windows/Linux/Mac 兼容

### 设计决策

| 决策 | 选项 | 选择 | 原因 |
|------|------|------|------|
| 实例管理 | 单例 vs 多例 | **单例** | 测试间共享，避免重复启动 |
| 端口 | 3000 vs 3100 | **3100** | 避免与开发环境冲突 |
| 启动方式 | 同步 vs 异步 | **异步+轮询** | 准确检测就绪状态 |
| 清理方式 | SIGTERM vs SIGKILL | **SIGTERM+超时** | 优雅关闭优先 |

---

## 📈 下一步

### 阶段 3: E2E 测试改造

**目标**: 将所有 E2E 测试改用 daemon 模式

**计划**:
1. 修改 `test/e2e/scenarios/mybatis/*.test.ts`
2. 添加 `beforeAll` / `afterAll` 钩子
3. 替换 `execCLI` 为 `execCLIWithDaemon`
4. 验证性能改善效果

**预期**:
- 13个 allCommands 测试: 178s → **~60s**
- 32个全量测试: ~430s → **~150s**

---

## ✅ 完成检查清单

- [x] 分析现有 daemon 启动和管理逻辑
- [x] 扩展 testUtils.ts 支持 daemon 模式
- [x] 实现 daemon 生命周期管理（启动/停止/健康检查）
- [x] 添加测试间连接复用机制
- [x] 实现优雅关闭和清理
- [x] 编写 daemon 模式测试验证

---

**阶段 2 状态**: ✅ 已完成  
**实际耗时**: ~60分钟  
**代码新增**: ~250行  
**下一步**: 阶段 3 - E2E 测试改造（应用 daemon 模式到所有测试）
