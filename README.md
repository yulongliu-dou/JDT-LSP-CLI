# JDT LSP CLI

> CLI tool for Java LSP operations, enabling AI agents to call Java language features from the command line

[![npm version](https://img.shields.io/npm/v/jdt-lsp-cli.svg)](https://www.npmjs.com/package/jdt-lsp-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 简介

JDT LSP CLI 是一个基于 Eclipse JDT Language Server 的命令行工具，为 AI Agent 和开发者提供强大的 Java 代码分析能力：

- 🔍 **符号搜索**: 跨项目搜索类、方法、字段
- 📍 **精确定位**: 跳转到定义、查找引用、类型跳转
- 🔗 **调用链分析**: 分析方法调用关系，支持多种模式
- 📚 **文档提取**: 获取 Javadoc 和类型信息
- ⚡ **守护进程**: 快速响应，性能提升 10-100 倍

## 快速开始

### 安装

```bash
npm install -g jdt-lsp-cli
jls --version
```

### 基本使用

```bash
# 启动守护进程（推荐）
jls daemon start --eager --init-project /path/to/java-project

# 搜索类
jls -p /path/to/project find SqlSession --kind Class

# 获取文件符号
jls sym src/main/java/org/example/MyClass.java --flat

# 分析调用链
jls ch src/main/java/org/example/Service.java --method processOrder -d 3
```

## 文档导航

### 📚 命令文档

#### LSP 命令

| 命令 | 别名 | 功能 | 文档 |
|------|------|------|------|
| `find` | `f` | 全局符号搜索 | [📖](docs/commands/find-全局符号搜索.md) |
| `symbols` | `sym` | 获取文件符号 | [📖](docs/commands/symbols-文档符号.md) |
| `definition` | `def` | 跳转定义 | [📖](docs/commands/definition-跳转定义.md) |
| `references` | `refs` | 查找引用 | [📖](docs/commands/references-查找引用.md) |
| `hover` | | 悬停信息 | [📖](docs/commands/hover-悬停信息.md) |
| `call-hierarchy` | `ch` | 调用链分析 | [📖](docs/commands/call-hierarchy-调用链分析.md) |
| `implementations` | `impl` | 查找实现 | [📖](docs/commands/implementations-查找实现.md) |
| `type-definition` | `typedef` | 类型跳转 | [📖](docs/commands/type-definition-类型定义.md) |

#### 管理命令

| 命令 | 功能 | 文档 |
|------|------|------|
| `daemon` | 守护进程管理 | [📖](docs/commands/daemon-守护进程管理.md) |
| `config` | 配置管理 | [📖](docs/commands/config-配置管理.md) |

### 🔧 参考文档

- [全局选项](docs/全局选项.md) - 所有命令的通用选项
- [符号定位指南](docs/commands/definition-跳转定义.md#符号定位选项) - 精确定位符号的方法

## 核心特性

### 🎯 精确定位

支持多种符号定位方式：

```bash
# 方法名定位
jls def MyClass.java --method myMethod

# 签名匹配（区分重载）
jls def MyClass.java --method process --signature "(String, int)"

# 索引选择
jls def MyClass.java --method process --index 0

# 全局搜索
jls def --global --symbol ArrayList --kind Class
```

### ⚡ 守护进程模式

```bash
# 启动并预初始化
jls daemon start --eager --init-project /path/to/project --wait

# 享受毫秒级响应
jls find MyClass          # 5-500ms（而非 30-60s）
jls sym MyClass.java      # 即时响应
```

### 🤖 AI 友好模式

`call-hierarchy` 命令提供多种 AI Agent 友好的查询模式：

```bash
# 惰性加载模式 - 按需探索
jls ch Service.java --method process --mode lazy

# 摘要模式 - 快速理解
jls ch Service.java --method process --mode summary

# 快照模式 - 完整存档
jls ch Service.java --method process --mode snapshot --snapshot-path ./output
```

### 📦 紧凑输出

减少 token 消耗，适合 AI Agent：

```bash
jls def MyClass.java --method myMethod --json-compact
```

## 典型工作流

```bash
# 1. 启动守护进程
jls daemon start --eager --init-project /path/to/project --wait

# 2. 搜索目标类
jls find UserService --kind Class

# 3. 查看类结构
jls sym src/main/java/com/example/UserService.java --flat

# 4. 分析方法调用链
jls ch src/main/java/com/example/UserService.java --method processOrder -d 3

# 5. 查找方法实现
jls impl src/main/java/com/example/OrderService.java --method createOrder

# 6. 获取方法文档
jls hover src/main/java/com/example/OrderService.java --method createOrder

# 7. 查找所有引用
jls refs src/main/java/com/example/UserService.java --method processOrder
```

## 性能对比

| 模式 | 首次命令 | 后续命令 |
|------|----------|----------|
| 守护进程模式 | 30-60s | **5-500ms** |
| 直接模式 | 30-60s | 30-60s |

## 测试

本项目包含完整的测试套件（115+ 用例），覆盖单元测试和 E2E 测试：

```bash
# 运行单元测试（快速，~0.5秒）
npm run test:unit

# 运行 E2E 测试（基于 MyBatis-3 项目）
npm run test:mybatis

# 生成覆盖率报告
npm run test:coverage
```

### 测试性能优化成果

通过 **TypeScript 编译缓存** + **Daemon 模式共享 JDT LS**，E2E 测试性能实现显著提升：

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 单元测试 | ~2s | **0.45s** | **75%** |
| E2E 单命令 | 18.5s | **7.8s** | **58%** |
| E2E 全量(32用例) | ~10min | **~3min** | **67%** |

详见 [test/README.md](test/README.md) 获取完整测试文档。

## 项目结构

```
jdt-lsp-cli/
├── docs/                      # 文档目录
│   ├── commands/              # 各命令的详细文档
│   └── 全局选项.md          # 全局选项文档
├── src/                       # 源代码
│   ├── cli/                   # CLI 命令实现
│   ├── core/                  # 核心功能
│   ├── jdt/                   # JDT LS 集成
│   └── services/              # 服务层
├── test/                      # 测试套件
│   ├── unit/                  # 单元测试
│   ├── e2e/                   # E2E 测试（MyBatis-3）
│   └── helpers/               # 测试工具
└── README.md                  # 本文件（文档索引）
```

## 相关资源

- [Eclipse JDT LS](https://github.com/eclipse/eclipse.jdt.ls) - Eclipse Java Language Server
- [Red Hat Java Extension](https://marketplace.visualstudio.com/items?itemName=redhat.java) - VS Code Java 扩展
- [LSP Specification](https://microsoft.github.io/language-server-protocol/) - Language Server Protocol 规范

## License

MIT License - 详见 [LICENSE](LICENSE) 文件
