# E2E 测试性能分析与优化方案

## 📊 当前性能现状

### 测试规模
- **测试文件数**: 7个
- **E2E 测试用例**: 32个（MyBatis-3 场景）
- **单元测试用例**: 73个

### 实际耗时测量

| 命令类型 | 单次执行时间 | 说明 |
|---------|------------|------|
| `find` 命令 | ~26秒 | 需要启动 JDT LS + 索引项目 |
| `ch` (call-hierarchy) 命令 | ~15秒 | 需要启动 JDT LS + 解析调用链 |
| `symbols` 命令 | ~20秒 | 估算值 |
| `def`/`ref` 命令 | ~18秒 | 估算值 |

### 总耗时估算

```
E2E 测试总耗时 = 32个用例 × 平均20秒 = 640秒 ≈ 10.7分钟
```

**实际运行**: 第一次运行 32个用例需要 10-20 分钟

---

## 🔍 性能瓶颈分析

### 瓶颈 1: JDT LS 冷启动（占 80%+ 时间）

**问题**: 
- 每个测试用例使用 `--no-daemon` 模式
- 每次都要重新启动 JDT Language Server
- JDT LS 启动需要 10-15 秒
- 项目索引需要 5-10 秒

**影响范围**: 所有 E2E 测试用例

**根因**: 
```typescript
// testUtils.ts - 每次 execCLI 都启动新进程
const cliArgs = ['--no-daemon', ...args];
exec(`node "${cliPath}" ${cliArgs.join(' ')}`, ...);
```

### 瓶颈 2: 测试串行执行（--runInBand）

**问题**:
- Jest 使用 `--runInBand` 参数
- 32个用例完全串行执行
- 无法利用多核 CPU

**影响**: 总耗时 = 所有用例耗时之和

**根因**: 
```bash
npm run test:e2e -- --runInBand
```

### 瓶颈 3: 重复的项目初始化

**问题**:
- 每个测试用例都要重新初始化 MyBatis 项目
- 相同的索引过程重复 32 次
- 浪费大量时间在重复工作上

**影响**: 每次 ~5-10 秒的索引时间

### 瓶颈 4: TypeScript 编译开销

**问题**:
- ts-jest 每次运行都要编译 TypeScript
- 没有使用缓存

**影响**: 每次测试启动额外 2-3 秒

---

## 🎯 优化方案

### 方案 A: 使用 Daemon 模式（推荐 ⭐⭐⭐⭐⭐）

**原理**: 
- 启动一次 JDT LS 守护进程
- 所有测试用例共享这个进程
- 避免重复启动和索引

**实现**:
```typescript
// test/helpers/testUtils.ts
export async function startTestDaemon() {
  return execCLI(['daemon', 'start', '--port', '3001']);
}

export async function stopTestDaemon() {
  return execCLI(['daemon', 'stop', '--port', '3001']);
}

// 测试文件
describe('MyBatis E2E', () => {
  beforeAll(async () => {
    await startTestDaemon();
    await waitForDaemon(3001);
  });
  
  afterAll(async () => {
    await stopTestDaemon();
  });
  
  it('测试用例1', async () => {
    // 这里不加 --no-daemon，使用 daemon 模式
    const result = await execCLI([
      '-p', MYBATIS_PROJECT.path,
      'find', 'SqlSession'
    ]);
  });
});
```

**预期效果**:
- 首次启动: ~18秒（一次性）
- 后续用例: ~2-3秒/个（直接查询）
- **总耗时**: 18秒 + 32 × 3秒 = **114秒 ≈ 2分钟**
- **加速比**: **5-10倍**

**优点**:
- ✅ 加速效果显著（5-10x）
- ✅ 实现简单，改动小
- ✅ 模拟真实使用场景
- ✅ 可以并行执行测试

**缺点**:
- ⚠️ 需要管理 daemon 生命周期
- ⚠️ 测试失败可能残留 daemon 进程
- ⚠️ 需要处理端口冲突

---

### 方案 B: 测试用例分组 + 共享 Daemon（推荐 ⭐⭐⭐⭐）

**原理**:
- 将相关测试用例分组
- 每组启动一次 daemon
- 组内用例共享 daemon

**实现**:
```typescript
// test/e2e/scenarios/mybatis/sqlSession.test.ts
describe('MyBatis E2E - SqlSession', () => {
  beforeAll(async () => {
    await execCLI(['daemon', 'start']);
    await waitForDaemon();
  });
  
  afterAll(async () => {
    await execCLI(['daemon', 'stop']);
  });
  
  describe('selectOne', () => {
    it('用例1', async () => { ... });
    it('用例2', async () => { ... });
    it('用例3', async () => { ... });
  });
});
```

**预期效果**:
- 3个测试文件 = 3次 daemon 启动
- **总耗时**: 3 × 18秒 + 32 × 3秒 = **150秒 ≈ 2.5分钟**
- **加速比**: **4-7倍**

**优点**:
- ✅ 测试隔离性好
- ✅ 失败影响范围小
- ✅ 可以并行执行不同组

**缺点**:
- ⚠️ 仍有重复启动开销
- ⚠️ 需要合理分组

---

### 方案 C: 并行执行测试（推荐 ⭐⭐⭐⭐）

**原理**:
- 移除 `--runInBand` 参数
- Jest 自动并行执行测试
- 每个测试使用独立端口

**实现**:
```bash
# package.json
"test:e2e": "jest test/e2e --maxWorkers=4"
```

```typescript
// 每个测试文件使用不同端口
const daemonPort = 3000 + process.env.JEST_WORKER_ID;
```

**预期效果**:
- 4个并行 worker
- **总耗时**: 10分钟 / 4 = **2.5分钟**
- **加速比**: **4倍**

**优点**:
- ✅ 充分利用多核 CPU
- ✅ Jest 原生支持
- ✅ 无需修改测试代码

**缺点**:
- ⚠️ 需要更多系统资源
- ⚠️ daemon 端口管理复杂
- ⚠️ 可能影响其他服务

---

### 方案 D: 增量测试 + 快照（推荐 ⭐⭐⭐）

**原理**:
- 首次运行生成快照
- 后续只测试变更的文件
- 使用 Jest 快照测试

**实现**:
```bash
# 只运行与变更文件相关的测试
npm run test:e2e -- --findRelatedTests src/cli/commandHandlers.ts
```

**预期效果**:
- 变更 10% 代码
- **总耗时**: 10分钟 × 10% = **1分钟**
- **加速比**: **10倍**（仅对增量场景）

**优点**:
- ✅ 增量场景极快
- ✅ CI/CD 友好

**缺点**:
- ⚠️ 首次运行仍然慢
- ⚠️ 需要维护快照
- ⚠️ 可能漏测

---

### 方案 E: Mock JDT LS 响应（推荐 ⭐⭐⭐）

**原理**:
- 不启动真实 JDT LS
- Mock LSP 协议响应
- 使用预定义的 JSON 响应

**实现**:
```typescript
// test/mocks/jdtLSMock.ts
export const mockResponses = {
  'find:SqlSession': {
    success: true,
    data: { symbols: [...], count: 12 }
  }
};

// 替换 execCLI
export async function execCLIMock(args: string[]) {
  const key = generateMockKey(args);
  return mockResponses[key] || defaultResponse;
}
```

**预期效果**:
- 单次测试: <1秒
- **总耗时**: 32 × 1秒 = **32秒**
- **加速比**: **20倍+**

**优点**:
- ✅ 极快（毫秒级）
- ✅ 不依赖外部环境
- ✅ 完全可控

**缺点**:
- ⚠️ 不测试真实 JDT LS
- ⚠️ 需要维护 mock 数据
- ⚠️ 可能遗漏真实环境问题

---

### 方案 F: TypeScript 编译优化（辅助方案 ⭐⭐）

**原理**:
- 启用 ts-jest 缓存
- 预编译测试文件

**实现**:
```javascript
// jest.config.js
module.exports = {
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      sourceMap: true,
      isolatedModules: true, // 使用 Babel 加速
    }],
  },
  cache: true, // 启用缓存
};
```

**预期效果**:
- 第二次运行加速 30-50%
- **总耗时**: 10分钟 → **6-7分钟**
- **加速比**: **1.5倍**

**优点**:
- ✅ 配置简单
- ✅ 无副作用

**缺点**:
- ⚠️ 加速有限
- ⚠️ 首次运行无改善

---

## 📋 方案对比总结

| 方案 | 预期耗时 | 加速比 | 实现难度 | 测试真实性 | 推荐度 |
|------|---------|--------|---------|-----------|--------|
| **A: Daemon 模式** | 2分钟 | 5-10x | ⭐⭐ | ✅ 高 | ⭐⭐⭐⭐⭐ |
| **B: 分组共享** | 2.5分钟 | 4-7x | ⭐⭐ | ✅ 高 | ⭐⭐⭐⭐ |
| **C: 并行执行** | 2.5分钟 | 4x | ⭐ | ✅ 高 | ⭐⭐⭐⭐ |
| **D: 增量测试** | 1分钟* | 10x* | ⭐⭐⭐ | ✅ 中 | ⭐⭐⭐ |
| **E: Mock 响应** | 32秒 | 20x+ | ⭐⭐⭐⭐ | ❌ 低 | ⭐⭐⭐ |
| **F: TS 编译优化** | 6-7分钟 | 1.5x | ⭐ | ✅ 高 | ⭐⭐ |

*仅增量场景

---

## 🎯 推荐组合策略

### 阶段 1: 快速优化（立即可用）

**组合**: 方案 A + 方案 F

```bash
# 1. 启用 ts-jest 缓存
npm run test:e2e

# 2. 使用 daemon 模式
# 修改 testUtils.ts 支持 daemon 模式
```

**预期效果**: 
- 从 10-20分钟 → **2-3分钟**
- **加速 5-8倍**
- 实现时间: **1-2小时**

---

### 阶段 2: 进一步优化（1-2天）

**组合**: 方案 B + 方案 C

```bash
# 分组 + 并行
npm run test:e2e -- --maxWorkers=4
```

**预期效果**:
- 从 2-3分钟 → **1-1.5分钟**
- **累计加速 10-15倍**
- 实现时间: **1-2天**

---

### 阶段 3: 终极优化（3-5天）

**组合**: 方案 E（用于开发） + 方案 A（用于 CI）

- **开发时**: Mock 模式，秒级反馈
- **CI/CD**: Daemon 模式，真实测试

**预期效果**:
- 开发测试: **<1分钟**
- CI 测试: **2-3分钟**
- 实现时间: **3-5天**

---

## 💡 立即可用的快速修复

### 1. 启用 Jest 缓存（5分钟）

```javascript
// jest.config.js
module.exports = {
  cache: true,
  cacheDirectory: './node_modules/.cache/jest',
};
```

### 2. 添加测试进度输出（10分钟）

```javascript
// jest.config.js
module.exports = {
  reporters: [
    'default',
    ['jest-progress-bar', { summarize: true }]
  ],
};
```

### 3. 超时优化（5分钟）

```javascript
// jest.config.js
module.exports = {
  testTimeout: 30000, // 从 60秒 降到 30秒
};
```

---

## 📊 投资回报分析

| 优化阶段 | 投入时间 | 节省时间/次 | 回本次数 | 年度节省（按每天5次） |
|---------|---------|-----------|---------|---------------------|
| 阶段 1 | 2小时 | 8-17分钟 | 1次 | 290-600小时 |
| 阶段 2 | 1-2天 | 10-18分钟 | 4次 | 360-650小时 |
| 阶段 3 | 3-5天 | 15-19分钟 | 10次 | 540-690小时 |

---

## 🚀 下一步行动

请选择你想要实施的优化方案，我将为你提供详细的实现代码和指导。

**推荐优先级**:
1. **立即**: 方案 F（5分钟，无风险）
2. **今天**: 方案 A（2小时，效果显著）
3. **本周**: 方案 B + C（1-2天，进一步优化）
4. **本月**: 方案 E（3-5天，终极方案）
