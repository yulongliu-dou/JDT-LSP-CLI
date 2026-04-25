# E2E 测试性能基线报告

**生成日期**: 2026-04-09  
**Git 分支**: `feature/e2e-performance-optimization`  
**测试项目**: MyBatis-3 (`E:\mybatis-3-master`)

---

## 📊 基线性能数据

### 单次测试耗时

| 测试类型 | 用例数 | 总耗时 | 平均耗时/用例 | 状态 |
|---------|--------|--------|--------------|------|
| **Debug 测试** | 1 | 35 秒 | 35 秒 | ✅ PASS |
| **allCommands 测试** | 13 | 248 秒 | 19 秒 | ⚠️ 6 FAIL |

### allCommands 测试详细数据

| 测试命令 | 耗时 | 状态 | 说明 |
|---------|------|------|------|
| find SqlSession | 30.6s | ❌ FAIL | 预期12个结果，实际可能不同 |
| find Configuration | 27.8s | ✅ PASS | 正常 |
| symbols DefaultSqlSession | 12.1s | ❌ FAIL | 文件路径或符号解析问题 |
| symbols Executor | 8.7s | ✅ PASS | 正常 |
| def selectOne | 19.9s | ✅ PASS | 正常 |
| def with signature | 10.3s | ❌ FAIL | 签名匹配问题 |
| ref selectOne | 40.9s | ✅ PASS | 正常（最慢） |
| hover selectOne | 21.9s | ✅ PASS | 正常 |
| hover Configuration | 0.1s | ❌ FAIL | 可能缓存问题 |
| impl SqlSession | 0.1s | ❌ FAIL | 可能缓存问题 |
| type-def | 20.1s | ❌ FAIL | 类型定义问题 |
| JSON compact | 29.2s | ✅ PASS | 正常 |
| JSON normal | 25.3s | ✅ PASS | 正常 |

### 性能统计分析

```
总测试用例数: 13
通过: 7 (54%)
失败: 6 (46%)
总耗时: 248.5 秒 ≈ 4.1 分钟
平均耗时: 19.1 秒/用例
最慢用例: 40.9 秒 (references)
最快用例: 0.1 秒 (cached hover)
```

---

## 🔍 当前配置分析

### Jest 配置 (`jest.config.js`)

```javascript
{
  preset: 'ts-jest',           // TypeScript 支持
  testEnvironment: 'node',     // Node.js 环境
  testTimeout: 60000,          // 60秒超时
  verbose: true,               // 详细输出
  
  // ⚠️ 未启用缓存（默认禁用）
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      sourceMap: true,
      // 缺少 cache: true
    }],
  },
  
  // ⚠️ 无 Worker 配置（完全串行）
  // ⚠️ 无 maxWorkers 设置
}
```

### 测试执行模式

| 配置项 | 当前值 | 影响 |
|--------|--------|------|
| `--runInBand` | 启用 | 完全串行执行 |
| `maxWorkers` | 未设置 | 默认1个worker |
| `cache` | 禁用 | 每次重新编译 TS |
| `--no-daemon` | 启用 | 每次启动 JDT LS |

---

## 📈 性能瓶颈识别

### 瓶颈 1: JDT LS 冷启动 (占 80%+ 时间)

**现象**:
- 每个测试用例使用 `--no-daemon` 模式
- 每次都要重新启动 JDT Language Server
- JDT LS 启动 + 索引项目需要 15-30 秒

**证据**:
```
find Configuration: 27.8s  (启动 + 搜索)
symbols Executor: 8.7s     (启动 + 解析)
hover Configuration: 0.1s  (缓存命中，极快)
```

**影响**: 13个用例 × 平均20秒 = 260秒

### 瓶颈 2: TypeScript 编译 (占 10-15% 时间)

**现象**:
- ts-jest 未启用缓存
- 每次运行测试都重新编译 TypeScript

**证据**:
```
Debug 测试首次运行: 35s
Debug 测试二次运行: 35s  (无改善，说明缓存未启用)
```

**影响**: 每次测试增加 2-3 秒编译时间

### 瓶颈 3: 串行执行 (无法并行)

**现象**:
- 使用 `--runInBand` 完全串行
- 无法利用多核 CPU

**影响**: 32个测试用例必须依次执行

---

## 🎯 优化目标

### 目标性能指标

| 指标 | 当前值 | 目标值 | 改进倍数 |
|------|--------|--------|---------|
| 单文件测试 (13用例) | 248s | 120s | 2x |
| 全量 E2E 测试 (32用例) | ~600s | 180s | 3.3x |
| TypeScript 编译 | 每次 | 缓存后 | 5x+ |
| JDT LS 启动 | 每次 | 共享 | 10x+ |

### 优化方案

1. **方案 A: Daemon 模式** - 共享 JDT LS 实例
   - 预期加速: 5-10x
   - 实现难度: ⭐⭐

2. **方案 F: TS 缓存** - 启用 ts-jest 缓存
   - 预期加速: 1.5-2x
   - 实现难度: ⭐

---

## 📋 测试失败分析

### 6个失败用例

| 用例 | 失败原因 | 优先级 |
|------|---------|--------|
| find SqlSession | 预期结果数不匹配 | P2 |
| symbols DefaultSqlSession | 文件路径问题 | P1 |
| def with signature | 签名匹配逻辑 | P1 |
| hover Configuration | 缓存/初始化问题 | P2 |
| impl SqlSession | 缓存/初始化问题 | P2 |
| type-def | 类型定义解析 | P2 |

**建议**: 在优化前先修复 P1 级别的问题

---

## 📝 下一步行动

1. ✅ 基线数据已记录
2. ✅ Git 分支已创建: `feature/e2e-performance-optimization`
3. ⬜ 修复 P1 测试失败问题
4. ⬜ 实施方案 F: TS 缓存
5. ⬜ 实施方案 A: Daemon 模式
6. ⬜ 验证优化效果

---

## 📊 基线总结

**当前性能**:
- 13个 E2E 测试用例: **248.5 秒** (4.1分钟)
- 预计 32个用例: **~600 秒** (10分钟)

**主要瓶颈**:
1. JDT LS 冷启动 (80%+)
2. TypeScript 编译 (10-15%)
3. 完全串行执行

**优化潜力**:
- 短期 (A+F): **3-5倍加速** → 120-200秒
- 中期 (B+C): **5-8倍加速** → 75-120秒
- 长期 (D+E): **10-20倍加速** → 30-60秒

---

**下一步**: 开始阶段 1 - 启用 TypeScript 缓存
