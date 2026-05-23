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
- 📦 **jar 内类定位**: 自动解析 jdt:// URI 为真实 file:// 缓存文件，支持 JDK src.zip、Maven sources jar、Vineflower 反编译三级管道
- ⚡ **守护进程**: 快速响应，性能提升 10-100 倍

## 快速开始

### 安装

```bash
npm install -g jdt-lsp-cli
jls --version
```

### 基本使用

```bash
# 直接运行业务命令 — 首次自动完成 JRE 下载 + JDT LS 初始化
jls -p /path/to/project find SqlSession --kind Class

# 启动守护进程（推荐，后续命令毫秒级响应）
jls daemon start --eager --init-project /path/to/java-project

# 获取文件符号
jls sym src/main/java/org/example/MyClass.java --flat

# 分析调用链
jls ch src/main/java/org/example/Service.java --method processOrder -d 3
```

## 环境初始化

`jdt-lsp-cli` 需要两项运行时依赖：**JRE 21** 和 **JDT LS**。安装 npm 包后，首次运行业务命令时会自动完成两者的初始化，无需手动干预。

### JRE 自动初始化

首次运行时，系统自动检测 JRE 是否就绪。如未找到，则并发探测多个下载源并启动**多源竞速下载**——所有可达源同时下载，取最先完成的安装，其余自动取消并清理。

| 下载源 | 说明 |
|--------|------|
| TUNA 清华镜像 | `mirrors.tuna.tsinghua.edu.cn/Adoptium` |
| USTC 中科大镜像 | `mirrors.ustc.edu.cn/adoptium` |
| Adoptium 官方 | `api.adoptium.net` |
| GitHub Releases | `github.com/adoptium/temurin21-binaries/releases` |

**降级策略**（按优先级）：

1. 内嵌 JRE 缓存 (`~/.jdt-lsp-cli/jre/<version>/`) — 已下载则直接使用
2. 多源并发竞速下载 — 自动安装最快的镜像版本
3. 系统 JRE — 回退到 `JAVA_HOME` 或 `PATH` 中的 `java`

示例输出：

```
🔍 正在检测 Java 运行环境...
   未找到内嵌 JRE，正在并发探测可用下载源
   平台: windows x64

   ✅ TUNA 清华镜像          · 21.0.11_10     · 489ms
   ✅ USTC 中科大镜像         · 21.0.9_10      · 238ms
   ❌ GitHub Releases    · GitHub Releases 超时 (8s)
   ✅ Adoptium Official  · 21.0.11_10.0.LTS · 3621ms

⬇ 并发下载 (3 个源): TUNA 清华镜像, USTC 中科大镜像, Adoptium Official
   来源: USTC 中科大镜像
   ██████████████████████████████ 100%
   ✓ SHA256 校验通过
   ✓ 解压完成: ~/.jdt-lsp-cli/jre/21.0.9_10 (Java 21)
```

### JDT LS 自动初始化

JDT LS 不再从 Eclipse 远程下载，改为使用 npm 包内置的 `tar.gz` 压缩包。

- **postinstall 阶段**：`npm install` 完成后自动执行 `scripts/extract-jdtls.js`，将 `jdtls/jdt-language-server-*.tar.gz` 解压到 `~/.jdt-lsp-cli/jdtls/<version>/`
- **首次运行阶段**：`JdtLauncher.launch()` 检查缓存是否有效，如已解压则直接使用

**降级策略**（按优先级）：

1. `--jdtls-path` 用户指定路径
2. 内嵌 JDT LS 缓存 (`~/.jdt-lsp-cli/jdtls/<version>/`)
3. VS Code / Qoder 的 Red Hat Java 扩展内置 server

### 手动管理命令

| 命令 | 功能 |
|------|------|
| `jls jre status` | 查看 JRE 版本、路径、状态 |
| `jls jre download` | 重新下载 JRE（含交互选择源 `--choose`） |
| `jls jre remove` | 删除内嵌 JRE，回退到系统 Java |
| `jls jdt status` | 查看 JDT LS 版本、路径、状态 |
| `jls jdt update` | 从内置包重新解压安装 JDT LS |
| `jls jdt remove` | 删除内嵌 JDT LS，回退到其他来源 |

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
| `jre` | 内嵌 JRE 管理 | 见 [环境初始化](#环境初始化) |
| `jdt` | 内嵌 JDT LS 管理 | 见 [环境初始化](#环境初始化) |
| `config` | 配置管理 | [📖](docs/commands/config-配置管理.md) |
| `cache` | 缓存与源码定位 | [📖](docs/commands/library-缓存与源码定位.md) |

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

### 📦 缓存与源码定位（含 Jar 内类定位）

自动解析 JDT LS 返回的 `jdt://` URI 为真实可读的 `file://` 缓存文件，支持对 jar 内类源码的完整定位与浏览。此功能在 **daemon 模式** 下自动启用，通过四级解析管道获取源码：

| 优先级 | 源 | 行号精度 | 触发条件 |
|--------|------|----------|----------|
| 1. **JDK `src.zip`** | `exact` | `java.base` 等标准库（含 JDK 8 `rt.jar`） |
| 2. **Maven `sources.jar`** | `exact` | 项目传递依赖（如 `ognl`、`mybatis`） |
| 3. **Vineflower 反编译** | `best-effort` | 无 sources 的第三方 jar 类 |
| 4. **classFileContents** | `n/a` | 反编译失败或 class 文件本身 |

**工作原理**：当通过 `def`、`refs`、`impl` 或 `type` 命令查询 JDK / Maven 依赖中的类时，JDT LS 返回 `jdt://contents/...` 或 `jdt://jarentry/...` URI。daemon 路由处理器自动将其 **重写为本地文件路径**，使 AI Agent 可直接打开和索引源码。

```bash
# 查看缓存统计
jls cache stats

# 清理过期缓存
jls cache clean --stale

# 预热项目依赖
jls cache warm
```

**快速验证**（确认管道正常工作）：
```bash
# 1. JDK 类 → 应命中 jdk-src（优先 src.zip 而非 rt.jar 枚举）
jls find java.util.function.Function --kind Class

# 2. 三方依赖 → 应命中 sources-jar 或 decompiled
jls find ognl.Ognl --kind Class
```

**配置**（通过 daemon `/config` API 热更新）：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `libraryResolveEnabled` | `true` | jar 类解析总开关 |
| `sourceDownloadMode` | `mvn` | 下载策略：`mvn` / `http` / `none` |
| `decompiler` | `vineflower` | 反编译引擎 |
| `cacheTtlDays` | `7` | 缓存生存天数 |

详见 [缓存与源码定位](docs/commands/library-缓存与源码定位.md)。

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
# 1. 首次命令 — 自动完成 JRE 下载 + JDT LS 初始化，然后执行搜索
jls find UserService --kind Class

# 2. 启动守护进程（后续命令毫秒级响应）
jls daemon start --eager --init-project /path/to/project --wait

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

| 模式 | 首次命令（含 JRE 下载） | 首次命令（有缓存） | 后续命令 |
|------|--------------------------|-------------------|----------|
| 守护进程模式 | ~35s | 30-60s | **5-500ms** |
| 直接模式 | ~35s | 30-60s | 30-60s |

## 测试

本项目包含完整的测试套件（297 用例），覆盖单元测试、集成测试和 E2E 测试：

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
├── jdtls/                     # 内置 JDT LS tar.gz 压缩包（构建时打入 npm 包）
├── scripts/                   # 构建与安装脚本
│   ├── extract-jdtls.js       # postinstall：解压内置 JDT LS
│   └── download-jdtls.js      # 构建：下载 JDT LS tar.gz
├── src/                       # 源代码
│   ├── cli/                   # CLI 命令实现
│   ├── core/                  # 核心功能
│   ├── jdt/                   # JDT LS 集成
│   │   └── embedded/          # 内嵌运行时管理 (JRE + JDT LS)
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
