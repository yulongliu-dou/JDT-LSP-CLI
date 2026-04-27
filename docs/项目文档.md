# JDT-LSP-CLI 测试文档

## 测试概述

本项目使用 Jest 作为测试框架，包含三个层次的测试：

1. **单元测试（Unit Tests）** - 测试纯逻辑函数
2. **集成测试（Integration Tests）** - 测试 CLI 命令和 API
3. **端到端测试（E2E Tests）** - 基于 MyBatis-3 真实项目的完整测试

## 快速开始

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试
npm run test:integration

# 运行 E2E 测试（需要 MyBatis-3 项目）
npm run test:e2e

# 运行 MyBatis 专项测试
npm run test:mybatis

# 生成覆盖率报告
npm run test:coverage

# 监视模式（开发时使用）
npm run test:watch
```

## 测试结构

```
test/
├── unit/                          # 单元测试
│   ├── services/
│   │   ├── symbolService.test.ts         # 符号解析服务（50+ 用例）
│   │   └── enhancedCallHierarchy/
│   │       └── helpers.test.ts           # 增强调用链工具
│   └── core/
│       └── utils/
│           └── symbolKind.test.ts        # 符号类型转换
│
├── integration/                   # 集成测试（待扩展）
│   ├── cli/
│   └── daemon/
│
├── e2e/                           # E2E 测试
│   ├── fixtures/
│   │   └── mybatis-3/
│   │       └── test-config.json  # MyBatis 测试配置
│   └── scenarios/
│       └── mybatis/
│           ├── sqlSession.test.ts        # SqlSession 调用链（20+ 用例）
│           ├── executor.test.ts          # Executor 层次（10+ 用例）
│           └── allCommands.test.ts       # 全命令覆盖（15+ 用例）
│
├── helpers/
│   └── testUtils.ts              # 测试工具函数
└── jest.d.ts                     # Jest 类型声明
```

## 测试用例统计

| 测试类型 | 文件数 | 用例数 | 覆盖模块 |
|---------|-------|--------|---------|
| 单元测试 | 3 | 70+ | symbolService, symbolKind, helpers |
| 集成测试 | 0 | 0 | 待扩展 |
| E2E 测试 | 3 | 45+ | SqlSession, Executor, 全命令 |
| **总计** | **6** | **115+** | - |

## E2E 测试环境

### 必需条件

1. **MyBatis-3 项目**
   - 默认路径: `E:\mybatis-3-master`
   - 可通过环境变量覆盖: `MYBATIS_PROJECT_PATH`

2. **JDT Language Server**
   - 首次运行会自动下载
   - 需要 Java JDK 17+

3. **构建项目**
   ```bash
   npm run build
   ```

### 配置 MyBatis 项目路径

```bash
# Windows PowerShell
$env:MYBATIS_PROJECT_PATH="E:\mybatis-3-master"

# Windows CMD
set MYBATIS_PROJECT_PATH=E:\mybatis-3-master

# Linux/Mac
export MYBATIS_PROJECT_PATH=/path/to/mybatis-3
```

## 测试用例详解

### 单元测试

#### symbolService.test.ts (50+ 用例)

**签名提取测试**:
- `extractSignature`: 从方法 detail 提取签名
- `extractSimpleSignature`: 简化签名格式
- 支持泛型、多参数、无参数等场景

**签名规范化测试**:
- `normalizeGenericType`: 移除泛型参数
- `normalizeSignature`: 规范化为小写逗号分隔
- 处理空格、泛型、数组等

**签名匹配测试**:
- `matchSignature`: 精确/模糊匹配
- 支持带括号、不带括号格式
- 忽略大小写和参数名

**模糊名称匹配测试**:
- `fuzzyMatchName`: 前缀、部分匹配
- 支持驼峰命名、下划线分隔

#### symbolKind.test.ts (20+ 用例)

- 14种符号类型的双向转换
- 大小写不敏感
- 无效值处理

#### helpers.test.ts (7 用例)

- 方法 ID 生成唯一性
- 不同输入产生不同 ID
- 特殊字符和中文支持

### E2E 测试

#### sqlSession.test.ts (20+ 用例)

**selectOne 方法调用链**:
- outgoing 调用链（向下）
- incoming 调用链（向上）
- 使用 signature 区分重载

**selectList 方法调用链**:
- 不同深度测试（1, 2, 3）
- 验证调用链完整性

**insert/update/delete 方法**:
- 验证 CRUD 操作调用链

**AI 友好模式**:
- summary 模式（摘要）
- lazy 模式（惰性加载）
- snapshot 模式（完整快照）

#### executor.test.ts (10+ 用例)

**接口实现查找**:
- Executor 接口的 4+ 个实现
- BaseExecutor 的子类

**方法定义跳转**:
- SimpleExecutor.query
- CachingExecutor.query

**调用链分析**:
- SimpleExecutor.query 的 incoming
- BaseExecutor.doQuery 的 outgoing

**符号搜索**:
- 搜索 Executor 接口
- 搜索 SimpleExecutor 类

#### allCommands.test.ts (15+ 用例)

覆盖所有 CLI 命令：
- ✅ find - 全局符号搜索
- ✅ symbols - 获取文件符号
- ✅ definition - 跳转定义
- ✅ references - 查找引用
- ✅ hover - 悬停信息
- ✅ implementations - 查找实现
- ✅ type-definition - 类型跳转
- ✅ 输出格式选项（JSON/compact）

## 覆盖率目标

| 指标 | 目标 | 当前 |
|------|------|------|
| 行覆盖率 | 80%+ | 待测试 |
| 分支覆盖率 | 70%+ | 待测试 |
| 函数覆盖率 | 80%+ | 待测试 |
| 语句覆盖率 | 80%+ | 待测试 |

## 常见问题

### Q: MyBatis 项目路径不对怎么办？

A: 设置环境变量 `MYBATIS_PROJECT_PATH`:
```bash
$env:MYBATIS_PROJECT_PATH="你的路径"
```

### Q: 测试超时怎么办？

A: E2E 测试需要 JDT LS 启动和索引，可能较慢。可以：
1. 增加超时时间（修改 jest.config.js）
2. 先启动守护进程：`jls daemon start --eager`
3. 单独运行测试：`npm run test:mybatis`

### Q: Daemon 模式和 no-daemon 模式有什么区别？

A: E2E 测试已全面采用 Daemon 模式以提升性能：

| 模式 | 原理 | 适用场景 |
|------|------|---------|
| **Daemon 模式** | 测试前启动 daemon，所有用例共享 JDT LS | E2E 测试（**推荐**） |
| **no-daemon 模式** | 每个用例独立启动 JDT LS | 单次 CLI 调用调试 |

**性能对比**：
- no-daemon 单命令：~18.5秒（含 JDT LS 启动）
- **daemon 单命令：~7.8秒（仅执行）**
- **改善：58%**

### Q: 如何调试测试？

A: 使用 VS Code 调试：
1. 打开测试文件
2. 在测试用例旁点击 "Debug"
3. 或使用命令：`node --inspect-brk node_modules/.bin/jest --runInBand`

### Q: 如何添加新测试？

A: 
1. 单元测试：在 `test/unit/` 下创建 `.test.ts` 文件
2. E2E 测试：在 `test/e2e/scenarios/mybatis/` 下创建
3. 使用 `testUtils.ts` 中的辅助函数

## 持续集成

### GitHub Actions 示例

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - name: Upload Coverage
        uses: codecov/codecov-action@v3
```

## 测试最佳实践

1. **单元测试**: 纯逻辑，无外部依赖，快速运行
2. **集成测试**: Mock 外部服务，测试接口
3. **E2E 测试**: 真实环境，完整流程，标记为 slow

## 相关资源

- [Jest 文档](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/)
- [MyBatis-3 项目](https://github.com/mybatis/mybatis-3)
