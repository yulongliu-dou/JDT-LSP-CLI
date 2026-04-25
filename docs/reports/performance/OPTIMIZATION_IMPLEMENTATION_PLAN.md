# E2E 测试性能优化实施计划

## 📋 优化目标

**当前状态**: 32个 E2E 测试用例需要 **10-20分钟**  
**目标状态**: 优化至 **2-3分钟**（5-8倍加速）  
**实施方案**: 方案 A（Daemon 模式）+ 方案 F（TS 缓存）

---

## 🎯 实施阶段总览

| 阶段 | 内容 | 预计耗时 | 状态 |
|------|------|---------|------|
| **阶段 0** | 基准测试与准备工作 | 15分钟 | ✅ 已完成 |
| **阶段 1** | 启用 TypeScript 缓存（方案 F） | 30分钟 | ⬜ 待开始 |
| **阶段 2** | Daemon 模式基础设施（方案 A-1） | 1小时 | ⬜ 待开始 |
| **阶段 3** | E2E 测试改造（方案 A-2） | 1.5小时 | ⬜ 待开始 |
| **阶段 4** | 测试验证与优化 | 1小时 | ⬜ 待开始 |
| **阶段 5** | 文档更新与总结 | 30分钟 | ⬜ 待开始 |

**总预计时间**: 4-4.5小时

---

## 📝 详细实施步骤

### 阶段 0: 基准测试与准备工作 ⏱️ 15分钟

#### 0.1 记录当前性能基线
- [ ] 运行完整 E2E 测试套件，记录总耗时
- [ ] 记录每个测试文件的耗时
- [ ] 保存基准测试结果

**执行命令**:
```bash
# 运行 E2E 测试并记录时间
time npm run test:e2e -- --runInBand 2>&1 | tee benchmark-before.txt
```

**预期结果**: 10-20分钟

#### 0.2 检查当前配置
- [ ] 检查 Jest 配置
- [ ] 检查 ts-jest 配置
- [ ] 确认测试文件结构

**检查项**:
```bash
# 查看 Jest 配置
cat jest.config.js

# 查看测试文件数量
Get-ChildItem -Path test -Filter *.test.ts -Recurse | Measure-Object
```

#### 0.3 创建备份分支
- [ ] 创建 Git 分支用于此次优化
- [ ] 提交当前工作状态

**执行命令**:
```bash
git checkout -b feature/optimize-e2e-performance
git add .
git commit -m "feat: prepare for E2E performance optimization"
```

---

### 阶段 1: 启用 TypeScript 缓存（方案 F） ⏱️ 30分钟

#### 1.1 更新 Jest 配置
- [ ] 启用 ts-jest 缓存
- [ ] 配置缓存目录
- [ ] 启用 isolatedModules 加速编译

**修改文件**: `jest.config.js`

**变更内容**:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // ... 现有配置 ...
  
  // 新增：TypeScript 编译优化
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      sourceMap: true,
      isolatedModules: true, // 使用 Babel 转译，加速编译
    }],
  },
  
  // 新增：启用缓存
  cache: true,
  cacheDirectory: './node_modules/.cache/jest',
};
```

#### 1.2 更新 .gitignore
- [ ] 添加 Jest 缓存目录到 .gitignore

**修改文件**: `.gitignore`

**新增内容**:
```
# Jest 缓存
node_modules/.cache/jest
```

#### 1.3 验证缓存效果
- [ ] 首次运行测试（无缓存）
- [ ] 第二次运行测试（有缓存）
- [ ] 对比两次耗时

**执行命令**:
```bash
# 清理缓存
npm run test:e2e -- --clearCache

# 首次运行（建立缓存）
time npm run test:e2e -- --runInBand 2>&1 | tee ts-cache-first.txt

# 第二次运行（使用缓存）
time npm run test:e2e -- --runInBand 2>&1 | tee ts-cache-second.txt
```

**预期结果**: 第二次运行比第一次快 30-50%

#### 1.4 提交阶段 1 成果
- [ ] 提交配置变更
- [ ] 记录性能提升数据

**执行命令**:
```bash
git add jest.config.js .gitignore
git commit -m "perf: enable ts-jest cache and isolatedModules for faster E2E tests"
```

**阶段 1 完成标志**: ✅ TypeScript 编译速度提升 30-50%

---

### 阶段 2: Daemon 模式基础设施（方案 A-1） ⏱️ 1小时

#### 2.1 扩展 testUtils.ts
- [ ] 添加 daemon 启动函数
- [ ] 添加 daemon 停止函数
- [ ] 添加 daemon 状态检查函数
- [ ] 支持自定义端口

**修改文件**: `test/helpers/testUtils.ts`

**新增函数**:
```typescript
/**
 * 启动测试专用的 Daemon 进程
 */
export async function startTestDaemon(port: number = 3001): Promise<boolean> {
  try {
    const result = await execCLI(['daemon', 'start', '--port', String(port)]);
    if (result.stderr.includes('already running')) {
      console.log(`Daemon already running on port ${port}`);
      return true;
    }
    return true;
  } catch (error) {
    console.error('Failed to start daemon:', error);
    return false;
  }
}

/**
 * 停止测试专用的 Daemon 进程
 */
export async function stopTestDaemon(port: number = 3001): Promise<void> {
  try {
    await execCLI(['daemon', 'stop', '--port', String(port)]);
  } catch (error) {
    console.error('Failed to stop daemon:', error);
  }
}

/**
 * 等待 Daemon 就绪
 */
export async function waitForDaemon(port: number = 3001, timeout: number = 30000): Promise<boolean> {
  const http = await import('http');
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Status code: ${res.statusCode}`));
          }
        });
        req.on('error', reject);
      });
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
}
```

#### 2.2 修改 execCLI 支持 Daemon 模式
- [ ] 添加 `useDaemon` 选项
- [ ] 根据选项决定是否添加 `--no-daemon`

**修改函数**: `execCLI`

**变更内容**:
```typescript
export async function execCLI(
  args: string[],
  options: { 
    cwd?: string; 
    env?: NodeJS.ProcessEnv; 
    debug?: boolean;
    useDaemon?: boolean; // 新增：是否使用 daemon 模式
    daemonPort?: number; // 新增：daemon 端口
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { exec } = await import('child_process');
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli.js');
  
  // 根据 useDaemon 决定是否添加 --no-daemon
  const cliArgs = options.useDaemon ? [...args] : ['--no-daemon', ...args];
  
  // 如果使用 daemon，设置环境变量指定端口
  if (options.useDaemon && options.daemonPort) {
    const env = {
      ...process.env,
      ...options.env,
      JLS_DAEMON_PORT: String(options.daemonPort),
    };
    // ... 执行命令时使用这个 env
  }
  
  // ... 其余代码保持不变
}
```

#### 2.3 添加测试辅助钩子
- [ ] 创建通用的 beforeAll/afterAll 钩子
- [ ] 处理异常情况下的 daemon 清理

**新增文件**: `test/helpers/daemonTestSetup.ts`

**内容**:
```typescript
/**
 * Daemon 模式测试辅助钩子
 */

import { startTestDaemon, stopTestDaemon, waitForDaemon } from './testUtils';

const DEFAULT_DAEMON_PORT = 3001;

/**
 * 创建 Daemon 测试套件
 */
export function describeWithDaemon(
  name: string,
  fn: () => void,
  options: { port?: number; timeout?: number } = {}
) {
  const port = options.port || DEFAULT_DAEMON_PORT;
  
  beforeAll(async () => {
    console.log(`\n🚀 Starting test daemon on port ${port}...`);
    await startTestDaemon(port);
    const ready = await waitForDaemon(port, options.timeout || 30000);
    if (!ready) {
      throw new Error(`Daemon failed to start on port ${port}`);
    }
    console.log(`✅ Daemon ready on port ${port}\n`);
  }, 60000);
  
  afterAll(async () => {
    console.log(`\n🛑 Stopping test daemon on port ${port}...`);
    await stopTestDaemon(port);
    console.log(`✅ Daemon stopped\n`);
  });
  
  describe(name, fn);
}
```

#### 2.4 提交阶段 2 成果
- [ ] 提交 testUtils.ts 扩展
- [ ] 提交 daemonTestSetup.ts

**执行命令**:
```bash
git add test/helpers/testUtils.ts test/helpers/daemonTestSetup.ts
git commit -m "feat: add daemon mode infrastructure for E2E tests"
```

**阶段 2 完成标志**: ✅ Daemon 管理函数就绪，支持端口配置

---

### 阶段 3: E2E 测试改造（方案 A-2） ⏱️ 1.5小时

#### 3.1 改造 sqlSession.test.ts
- [ ] 使用 describeWithDaemon 包裹测试
- [ ] 移除每个用例的 `--no-daemon`
- [ ] 添加 daemon 模式选项

**修改文件**: `test/e2e/scenarios/mybatis/sqlSession.test.ts`

**变更内容**:
```typescript
import { execCLI, parseJSONOutput, MYBATIS_PROJECT } from '../../../helpers/testUtils';
import { describeWithDaemon } from '../../../helpers/daemonTestSetup';

// 使用 describeWithDaemon 替代 describe
describeWithDaemon('MyBatis E2E - SqlSession 核心调用链', () => {
  const sqlSessionFile = MYBATIS_PROJECT.files.defaultSqlSession;

  describe('selectOne 方法调用链', () => {
    it('应该获取 selectOne(String) 的 outgoing 调用链', async () => {
      const result = await execCLI([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectOne',
        '--index', '0',
        '-d', '3',
        '--json-compact'
      ], { useDaemon: true }); // 使用 daemon 模式
      
      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      // ... 其余断言
    }, 30000); // 超时从 60秒 降到 30秒
    
    // ... 其他用例同样修改
  });
});
```

#### 3.2 改造 executor.test.ts
- [ ] 同样使用 describeWithDaemon
- [ ] 所有 execCLI 调用添加 `{ useDaemon: true }`

**修改文件**: `test/e2e/scenarios/mybatis/executor.test.ts`

#### 3.3 改造 allCommands.test.ts
- [ ] 同样使用 describeWithDaemon
- [ ] 所有 execCLI 调用添加 `{ useDaemon: true }`

**修改文件**: `test/e2e/scenarios/mybatis/allCommands.test.ts`

#### 3.4 改造 debug.test.ts（如果保留）
- [ ] 同样使用 describeWithDaemon

**修改文件**: `test/e2e/debug.test.ts`

#### 3.5 提交阶段 3 成果
- [ ] 提交所有 E2E 测试文件修改

**执行命令**:
```bash
git add test/e2e/scenarios/mybatis/*.test.ts test/e2e/debug.test.ts
git commit -m "refactor: migrate E2E tests to daemon mode for faster execution"
```

**阶段 3 完成标志**: ✅ 所有 E2E 测试使用 daemon 模式

---

### 阶段 4: 测试验证与优化 ⏱️ 1小时

#### 4.1 运行完整测试套件
- [ ] 运行优化后的 E2E 测试
- [ ] 记录总耗时
- [ ] 验证所有测试通过

**执行命令**:
```bash
# 运行 E2E 测试
time npm run test:e2e -- --runInBand 2>&1 | tee benchmark-after.txt
```

**预期结果**: 
- 总耗时: **2-3分钟**
- 所有测试通过: ✅

#### 4.2 对比优化前后性能
- [ ] 计算加速比
- [ ] 分析每个测试文件的耗时变化
- [ ] 识别仍有性能问题的测试

**对比数据**:
```
优化前: XX 分钟
优化后: XX 分钟
加速比: X 倍
```

#### 4.3 处理失败的测试
- [ ] 修复因 daemon 模式导致的失败
- [ ] 处理端口冲突问题
- [ ] 处理超时问题

#### 4.4 优化 Jest 配置
- [ ] 根据测试结果调整超时时间
- [ ] 添加进度报告器
- [ ] 优化并行度（如果适用）

**可能的调整**:
```javascript
// jest.config.js
module.exports = {
  testTimeout: 30000, // 从 60秒 降到 30秒
  reporters: [
    'default',
    ['jest-progress-bar', { summarize: true }]
  ],
};
```

#### 4.5 提交阶段 4 成果
- [ ] 提交测试修复
- [ ] 提交配置优化

**执行命令**:
```bash
git add jest.config.js test/
git commit -m "fix: adjust E2E tests for daemon mode and optimize timeouts"
```

**阶段 4 完成标志**: ✅ 所有测试通过，性能达标

---

### 阶段 5: 文档更新与总结 ⏱️ 30分钟

#### 5.1 更新测试文档
- [ ] 更新 test/README.md
- [ ] 添加性能优化说明
- [ ] 更新快速开始指南

**修改文件**: `test/README.md`

**新增内容**:
```markdown
## 性能优化

E2E 测试已优化为使用 Daemon 模式，测试速度提升 5-8 倍。

### 运行优化后的 E2E 测试

```bash
# 运行 E2E 测试（使用 daemon 模式，约 2-3 分钟）
npm run test:e2e

# 首次运行会启动 daemon，后续用例复用
```

### 性能对比

| 模式 | 耗时 | 说明 |
|------|------|------|
| `--no-daemon` | 10-20分钟 | 每次启动 JDT LS |
| Daemon 模式 | 2-3分钟 | 共享 JDT LS 实例 |
```

#### 5.2 创建性能优化总结文档
- [ ] 记录优化过程
- [ ] 记录遇到的问题
- [ ] 记录解决方案

**创建文件**: `test/PERFORMANCE_OPTIMIZATION.md`

#### 5.3 更新主 README
- [ ] 在测试章节提及性能优化
- [ ] 添加性能数据

**修改文件**: `README.md`

#### 5.4 最终提交
- [ ] 提交所有文档更新
- [ ] 创建优化总结标签

**执行命令**:
```bash
git add test/README.md test/PERFORMANCE_OPTIMIZATION.md README.md
git commit -m "docs: update test documentation with performance optimization guide"

# 创建标签
git tag -a v1.7.3-e2e-optimized -m "E2E tests optimized: 5-8x faster with daemon mode"
```

#### 5.5 清理临时文件
- [ ] 删除基准测试文件
- [ ] 删除调试输出

**执行命令**:
```bash
rm -f benchmark-*.txt ts-cache-*.txt
```

**阶段 5 完成标志**: ✅ 文档完整，优化成果记录

---

## 📊 进度跟踪

### 总体进度

```
阶段 0: ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%
阶段 1: ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%
阶段 2: ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%
阶段 3: ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%
阶段 4: ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%
阶段 5: ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%

总体进度: 0%
```

### 时间跟踪

| 阶段 | 计划开始 | 计划结束 | 实际开始 | 实际结束 | 状态 |
|------|---------|---------|---------|---------|------|
| 阶段 0 | - | - | - | - | ⬜ 未开始 |
| 阶段 1 | - | - | - | - | ⬜ 未开始 |
| 阶段 2 | - | - | - | - | ⬜ 未开始 |
| 阶段 3 | - | - | - | - | ⬜ 未开始 |
| 阶段 4 | - | - | - | - | ⬜ 未开始 |
| 阶段 5 | - | - | - | - | ⬜ 未开始 |

### 遇到的问题

| 问题描述 | 发现阶段 | 解决方案 | 状态 |
|---------|---------|---------|------|
| | | | |

### 性能数据记录

| 测试项 | 优化前 | 优化后 | 提升 |
|--------|--------|--------|------|
| 完整 E2E 测试 | 分钟 | 分钟 | 倍 |
| TypeScript 编译（首次） | 秒 | 秒 | % |
| TypeScript 编译（缓存） | - | 秒 | - |
| Daemon 启动 | - | 秒 | - |
| 单个 E2E 用例 | 秒 | 秒 | 倍 |

---

## 🚨 回退方案

如果优化过程中遇到无法解决的问题，可以按以下步骤回退：

```bash
# 1. 查看提交历史
git log --oneline

# 2. 回退到优化前的提交
git reset --hard <commit-hash-before-optimization>

# 3. 或者创建新分支保留当前工作
git checkout -b feature/optimize-e2e-performance-backup
git checkout main
```

---

## ✅ 完成检查清单

### 功能检查
- [ ] 所有 E2E 测试通过
- [ ] Daemon 模式正常工作
- [ ] TypeScript 缓存生效
- [ ] 端口冲突处理正确
- [ ] 异常清理机制有效

### 性能检查
- [ ] 总耗时 < 3分钟
- [ ] 加速比 >= 5倍
- [ ] 首次运行时间合理
- [ ] 后续运行时间稳定

### 代码质量检查
- [ ] 代码已提交
- [ ] 提交信息清晰
- [ ] 无调试代码残留
- [ ] 无临时文件

### 文档检查
- [ ] README 已更新
- [ ] 测试文档已更新
- [ ] 性能数据已记录
- [ ] 问题已记录

---

## 📝 备注

- 实施过程中如有问题，及时记录在"遇到的问题"表格中
- 每个阶段完成后更新进度跟踪表格
- 性能数据要真实记录，不要估算

---

**创建时间**: 2026-04-09  
**预计完成时间**: 2026-04-09（4-4.5小时）  
**负责人**: AI Assistant
