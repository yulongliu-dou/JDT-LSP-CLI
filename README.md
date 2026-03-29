# JDT LSP CLI

> Java LSP 命令行工具 - 让 AI Agent 可以通过命令行调用 Java 语言服务能力

## 简介

JDT LSP CLI (`jls`) 是一个基于 Eclipse JDT Language Server 的命令行工具，将 Java IDE 的智能功能（如调用链分析、定义跳转、引用查找等）封装为命令行接口，使 AI Agent 可以通过简单的命令调用这些能力。

## 前置要求

- **Node.js** 18+
- **Red Hat Java 扩展**：需要在 VS Code/Qoder 中安装 "Language Support for Java(TM) by Red Hat" 扩展
  - 扩展会自动下载 Eclipse JDT LS 和 Java 21 运行时
  - 支持的扩展位置：
    - `~/.vscode/extensions/redhat.java-*`
    - `~/.qoder/extensions/redhat.java-*`

## 安装

```bash
# 克隆或进入项目目录
cd jdt-lsp-cli

# 安装依赖
npm install

# 编译并全局链接
npm run link

# 验证安装
jls --version
```

## 守护进程模式（推荐）

为了解决每次命令都需要冷启动 JDT LS 导致的性能问题，v1.1.0 引入了守护进程模式：

### 启动守护进程

```bash
# 启动守护进程（首次启动需要 30-60 秒初始化）
jls daemon start

# 预初始化模式（v1.4.0+）- 启动时立即初始化指定项目
jls daemon start --eager --project /path/to/java-project

# 检查状态
jls daemon status

# 列出已加载项目（v1.4.0+）
jls daemon list

# 释放指定项目（v1.4.0+）
jls daemon release /path/to/project

# 停止守护进程
jls daemon stop
```

### 性能对比

| 模式 | 首次命令 | 后续命令 |
|------|----------|----------|
| 守护进程模式 | 30-60秒（启动+索引） | **100-500ms** |
| 直接模式 | 30-60秒 | 30-60秒 |

### 工作原理

```
守护进程模式:
┌───────────────────────────────────┐
│  jls-daemon (常驻后台)             │
│  - JDT LS 已启动，保持运行            │
│  - 项目已索引，缓存就绪              │
│  - 监听 HTTP 127.0.0.1:9876       │
└───────────────────────────────────┘
         ↑ HTTP 请求 (毫秒级)
┌───────────────────────────────────┐
│  jls def file.java 25 10         │ ← 立即返回
│  jls refs file.java 30 5         │
│  jls sym file.java                │
└───────────────────────────────────┘
```

### 直接模式（不使用守护进程）

```bash
# 添加 --no-daemon 强制使用直接模式
jls --no-daemon def src/Main.java 10 5
```

### 守护进程文件位置

| 文件 | 路径 |
|------|------|
| PID 文件 | `~/.jdt-lsp-cli/daemon.pid` |
| 日志文件 | `~/.jdt-lsp-cli/daemon.log` |
| 配置文件 | `~/.jdt-lsp-cli/config.json` |
| 索引缓存 | `~/.jdt-lsp-cli/data/<project-hash>/` |

## JVM 配置与内存优化

v1.2.0 引入了配置文件支持，可自定义 JVM 参数以优化内存占用和稳定性。

### 配置命令

```bash
# 创建默认配置文件
jls config init

# 查看当前配置
jls config show

# 查看配置文件路径
jls config path

# 查看默认 JVM 配置
jls config defaults
```

### 配置文件结构

`~/.jdt-lsp-cli/config.json`:

```json
{
  "jvm": {
    "xms": "256m",                    // 初始堆大小
    "xmx": "2g",                      // 最大堆大小
    "useG1GC": true,                  // 使用 G1 垃圾收集器
    "maxGCPauseMillis": 200,          // 最大 GC 暂停时间（毫秒）
    "useStringDeduplication": true,   // 启用字符串去重
    "softRefLRUPolicyMSPerMB": 50,    // 软引用清理策略
    "extraArgs": []                   // 额外 JVM 参数
  },
  "daemon": {
    "port": 9876,                     // 守护进程端口
    "idleTimeoutMinutes": 30,         // 空闲超时（分钟，0=不超时）
    "maxProjects": 1,                 // 最大同时活跃项目数（v1.4.0+）
    "perProjectMemory": "1g"          // 每项目内存限制（v1.4.0+）
  }
}
```

### JVM 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `xms` | `256m` | 初始堆内存，低起始内存占用 |
| `xmx` | `2g` | 最大堆内存，防止内存无限增长 |
| `useG1GC` | `true` | G1 垃圾收集器，低延迟、内存友好 |
| `maxGCPauseMillis` | `200` | 控制 GC 暂停时间，保证响应性 |
| `useStringDeduplication` | `true` | 字符串去重（G1GC 专属），减少内存 |
| `softRefLRUPolicyMSPerMB` | `50` | 软引用清理迟钙，值越小清理越快 |
| `extraArgs` | `[]` | 自定义 JVM 参数，如 `-XX:+PrintGC` |

### 内存优化建议

**低内存机器（8GB RAM）：**
```json
{
  "jvm": {
    "xms": "128m",
    "xmx": "512m"
  }
}
```

**中等内存机器（16GB RAM）：**
```json
{
  "jvm": {
    "xms": "256m",
    "xmx": "1g"
  }
}
```

**高内存机器/大型项目：**
```json
{
  "jvm": {
    "xms": "512m",
    "xmx": "4g"
  }
}
```

### 应用配置

修改配置文件后需要重启守护进程：

```bash
jls daemon stop
jls daemon start
```

## 命令概览

| 命令 | 简写 | 说明 |
|------|------|------|
| `call-hierarchy` | `ch` | 获取方法调用链（向下调用） |
| `definition` | `def` | 跳转到符号定义 |
| `references` | `refs` | 查找所有引用 |
| `symbols` | `sym` | 获取文件符号列表 |
| `implementations` | `impl` | 查找接口/抽象方法实现 |
| `hover` | - | 获取悬停信息（类型、文档） |
| `find` | - | 全局符号搜索（v1.4.0+） |
| `type-definition` | `typedef` | 跳转到类型定义（v1.4.0+） |

## 符号定位功能（v1.3.0+）

所有位置敏感命令（除 `symbols` 外）现在支持 **基于符号名称自动定位**，无需手动指定行列位置。这对 AI Agent 特别有用，可以直接通过符号名称调用 LSP 功能。

### v1.4.0 增强

- **模糊匹配**：`--method` 和 `--symbol` 支持模糊匹配，无需完整签名
  - 仅有一个同名方法时，忽略签名要求直接返回
  - 泛型类型自动规范化：`List<String>` 可用 `List` 匹配
- **全局定位**：新增 `--global` 选项，无需指定文件路径
- **智能位置**：`hover` 命令使用符号中间位置，提高命中率

### 符号定位选项

| 选项 | 说明 | 示例 |
|------|------|------|
| `--method <name>` | 方法名定位 | `--method processOrder` |
| `--symbol <name>` | 符号名定位（类、字段等） | `--symbol UserService` |
| `--container <path>` | 父容器路径（用于嵌套符号） | `--container "MyClass.innerMethod"` |
| `--signature <sig>` | 方法签名（区分重载） | `--signature "(String, int)"` |
| `--index <n>` | 同名符号索引（0-based） | `--index 1` |
| `--kind <type>` | 符号类型 | `--kind Method` |

### 使用示例

```bash
# 基础用法 - 通过方法名定位（无重载）
jls call-hierarchy ./OrderService.java --method processOrder

# 有重载方法 - 使用签名区分
jls definition ./UserService.java --method findUser --signature "(Long)"

# 嵌套符号 - Lambda 中的方法
jls call-hierarchy ./StreamExample.java --container "MyClass.processItems" --method "lambda$0"

# 字段引用
jls references ./Config.java --symbol API_KEY --kind Field

# 接口实现查找
jls implementations ./PaymentGateway.java --symbol charge --kind Method

# 内部类方法
jls hover ./Outer.java --container "Outer.Inner" --method doWork

# 使用索引消歧（当有多个同名符号时）
jls definition ./Test.java --method process --index 1
```

### 三级精度匹配

| 级别 | 方式 | 适用场景 |
|------|------|----------|
| L1 | 仅名称 | 无重载、名称唯一 |
| L2 | 名称+签名 | 有重载方法 |
| L3 | 名称+索引 | 签名复杂或无法识别 |

### 错误处理与 AI 自修正

当符号定位失败或有歧义时，返回结构化信息帮助 AI 自我修正：

```json
{
  "success": false,
  "error": "Found 3 methods named 'process'. Please specify --signature or --index.",
  "data": {
    "resolution_error": {
      "type": "ambiguous",
      "message": "Found 3 methods named 'process'. Please specify --signature or --index.",
      "suggestions": {
        "overloadOptions": [
          "process [Method] - process(String) : void",
          "process [Method] - process(String, int) : boolean",
          "process [Method] - process(Order) : Result"
        ]
      }
    }
  }
}
```

### 兼容性

- 保留原有 `<file> <line> <col>` 参数方式
- 新旧方式互斥，优先使用 `--method/--symbol`
- 守护进程和直接模式均支持

## 全局选项

```bash
jls [command] [options]

选项:
  -p, --project <path>    Java 项目根目录 (默认：当前目录)
  --jdtls-path <path>     指定 eclipse.jdt.ls 路径 (可选)
  --data-dir <path>       JDT LS 数据目录 (可选)
  -v, --verbose           显示详细日志
  --timeout <ms>          操作超时时间 (默认：60000)
  --no-daemon             禁用守护进程模式，每次命令重新启动 JDT LS
  --json-compact          紧凑 JSON 输出，仅返回核心字段（v1.4.0+）
  -V, --version           显示版本号
  -h, --help              显示帮助信息
```

### 紧凑输出模式（--json-compact）

使用 `--json-compact` 可以显著减少输出体积，适合 AI Agent 快速解析。

**示例：**
```bash
# 标准输出 - 包含完整 Location 对象
jls def src/App.java --symbol userService

# 紧凑输出 - 只保留核心字段（uri + range.start）
jls def src/App.java --symbol userService --json-compact
```

**对比：**
```json
// 标准输出
{
  "success": true,
  "data": [
    {
      "uri": "file:///project/src/UserService.java",
      "range": {
        "start": { "line": 10, "character": 4 },
        "end": { "line": 10, "character": 20 }
      }
    }
  ]
}

// 紧凑输出 (--json-compact)
{
  "success": true,
  "data": [
    {
      "uri": "file:///project/src/UserService.java",
      "range": {
        "start": { "line": 10, "character": 4 }
      }
    }
  ]
}
```

**各命令的紧凑字段映射：**
| 命令 | 紧凑字段 |
|------|----------|
| `definition` | `uri`, `range.start.line`, `range.start.character` |
| `references` | `uri`, `range.start.line` |
| `symbols` | `name`, `kind`, `range.start.line` |
| `call-hierarchy` | `entry`, `calls`, `totalMethods` |
| `hover` | `contents` |
| `implementations` | `uri`, `range.start.line` |
| `type-definition` | `uri`, `range.start.line` |
| `workspaceSymbols` | `name`, `kind`, `location.uri`, `location.range.start.line` |

## 命令详解

### 1. call-hierarchy (ch) - 调用链分析

获取指定方法的调用链，分析方法调用了哪些其他方法。

```bash
jls ch <file> [line] [col] [options]

选项:
  -d, --depth <n>       最大递归深度 (默认: 5)
  --incoming            获取被调用关系（谁调用了我）
  --method <name>       通过方法名自动定位
  --container <path>    父容器路径
  --signature <sig>     方法签名（区分重载）
  --index <n>           同名符号索引
```

**示例：**
```bash
# 传统方式：指定行列
jls ch src/main/java/com/example/Service.java 25 10 -d 3

# 符号定位：通过方法名
jls ch src/main/java/com/example/Service.java --method execute -d 3

# 获取方法的被调用关系
jls ch src/main/java/com/example/Service.java --method execute --incoming
```

**输出示例：**
```json
{
  "success": true,
  "data": {
    "entry": {
      "name": "execute",
      "kind": 6,
      "uri": "file:///project/src/Service.java",
      "range": { "start": { "line": 24, "character": 9 } }
    },
    "calls": [
      {
        "depth": 0,
        "caller": "execute",
        "callee": "validateInput",
        "location": { "uri": "file:///project/src/Validator.java" }
      }
    ],
    "totalMethods": 15
  },
  "elapsed": 6500
}
```

### 2. definition (def) - 跳转定义

获取符号（类、方法、变量）的定义位置。

```bash
jls def <file> [line] [col] [options]

选项:
  --method <name>       通过方法名自动定位
  --symbol <name>       通过符号名自动定位
  --container <path>    父容器路径
  --signature <sig>     方法签名（区分重载）
  --index <n>           同名符号索引
```

**示例：**
```bash
# 传统方式：指定行列
jls def src/main/java/com/example/App.java 30 15

# 符号定位：通过符号名
jls def src/main/java/com/example/App.java --symbol UserService

# 重载方法：使用签名区分
jls def src/main/java/com/example/App.java --method findUser --signature "(Long)"
```

**输出示例：**
```json
{
  "success": true,
  "data": [
    {
      "uri": "file:///project/src/UserService.java",
      "range": {
        "start": { "line": 10, "character": 4 },
        "end": { "line": 10, "character": 20 }
      }
    }
  ],
  "elapsed": 1200
}
```

### 3. references (refs) - 查找引用

查找符号在整个项目中的所有引用位置。

```bash
jls refs <file> [line] [col] [options]

选项:
  --no-declaration      不包含声明本身
  --method <name>       通过方法名自动定位
  --symbol <name>       通过符号名自动定位
  --container <path>    父容器路径
  --signature <sig>     方法签名（区分重载）
  --index <n>           同名符号索引
  --kind <type>         符号类型 (Method, Field, Class...)
```

**示例：**
```bash
# 传统方式：指定行列
jls refs src/main/java/com/example/UserService.java 15 20

# 符号定位：通过方法名
jls refs src/main/java/com/example/UserService.java --method findById

# 字段引用
jls refs src/main/java/com/example/Config.java --symbol API_KEY --kind Field

# 不包含声明本身
jls refs src/main/java/com/example/UserService.java --method findById --no-declaration
```

**输出示例：**
```json
{
  "success": true,
  "data": {
    "references": [
      {
        "uri": "file:///project/src/Controller.java",
        "range": { "start": { "line": 45, "character": 12 } }
      }
    ],
    "count": 8
  },
  "elapsed": 2300
}
```

### 4. symbols (sym) - 文档符号

获取 Java 文件中的所有符号（类、方法、字段等）。

```bash
jls sym <file> [options]

选项:
  --flat    扁平化输出（不保留层级结构）
```

**示例：**
```bash
# 获取文件的符号树
jls sym src/main/java/com/example/UserService.java

# 扁平化列表
jls sym src/main/java/com/example/UserService.java --flat
```

**输出示例（扁平化）：**
```json
{
  "success": true,
  "data": {
    "symbols": [
      { "name": "UserService", "kind": 5, "parent": null },
      { "name": "findById", "kind": 6, "parent": "UserService" },
      { "name": "save", "kind": 6, "parent": "UserService" }
    ],
    "count": 12
  },
  "elapsed": 1500
}
```

### 5. implementations (impl) - 查找实现

查找接口或抽象方法的所有实现。

```bash
jls impl <file> [line] [col] [options]

选项:
  --method <name>       通过方法名自动定位
  --symbol <name>       通过符号名自动定位
  --container <path>    父容器路径
  --signature <sig>     方法签名（区分重载）
  --index <n>           同名符号索引
  --kind <type>         符号类型
```

**示例：**
```bash
# 传统方式：指定行列
jls impl src/main/java/com/example/Repository.java 8 10

# 符号定位：通过方法名
jls impl src/main/java/com/example/Repository.java --method save

# 接口实现
jls impl src/main/java/com/example/PaymentGateway.java --symbol charge --kind Method
```

**输出示例：**
```json
{
  "success": true,
  "data": {
    "implementations": [
      {
        "uri": "file:///project/src/JdbcRepository.java",
        "range": { "start": { "line": 15, "character": 4 } }
      },
      {
        "uri": "file:///project/src/MongoRepository.java",
        "range": { "start": { "line": 12, "character": 4 } }
      }
    ],
    "count": 2
  },
  "elapsed": 1800
}
```

### 6. hover - 悬停信息

获取符号的类型信息和文档注释。

```bash
jls hover <file> [line] [col] [options]

选项:
  --method <name>       通过方法名自动定位
  --symbol <name>       通过符号名自动定位
  --container <path>    父容器路径
  --signature <sig>     方法签名（区分重载）
  --index <n>           同名符号索引
  --kind <type>         符号类型
```

**示例：**
```bash
# 传统方式：指定行列
jls hover src/main/java/com/example/App.java 20 10

# 符号定位：通过方法名
jls hover src/main/java/com/example/App.java --method processOrder

# 内部类方法
jls hover src/main/java/com/example/Outer.java --container "Outer.Inner" --method doWork
```

**输出示例：**
```json
{
  "success": true,
  "data": {
    "contents": {
      "kind": "markdown",
      "value": "```java\npublic void processOrder(Order order)\n```\n\n处理订单业务逻辑\n\n@param order 订单对象"
    }
  },
  "elapsed": 800
}
```

### 7. find - 全局符号搜索（v1.4.0+）

在整个工作区中搜索符号，无需指定文件路径。

```bash
jls find <query> [options]

选项:
  --kind <type>     按符号类型过滤 (Class, Method, Field...)
  --limit <n>       返回结果数量限制 (默认: 50)
```

**示例：**
```bash
# 搜索所有包含 "User" 的符号
jls find User

# 只搜索类
jls find Service --kind Class

# 限制返回数量
jls find Config --limit 10
```

**输出示例：**
```json
{
  "success": true,
  "data": {
    "symbols": [
      {
        "name": "UserService",
        "kind": "Class",
        "containerName": "com.example.service",
        "location": {
          "uri": "file:///project/src/UserService.java",
          "range": { "start": { "line": 5, "character": 0 } }
        }
      }
    ],
    "count": 15
  },
  "elapsed": 500
}
```

### 8. type-definition (typedef) - 类型跳转（v1.4.0+）

跳转到变量或表达式的类型定义。

```bash
jls typedef <file> [line] [col] [options]

选项:
  --method <name>       通过方法名自动定位
  --symbol <name>       通过符号名自动定位
  --container <path>    父容器路径
  --signature <sig>     方法签名（区分重载）
  --index <n>           同名符号索引
```

**示例：**
```bash
# 传统方式：指定行列
jls typedef src/main/java/com/example/App.java 30 15

# 符号定位：跳转到字段的类型定义
jls typedef src/main/java/com/example/App.java --symbol userService
```

**输出示例：**
```json
{
  "success": true,
  "data": [
    {
      "uri": "file:///project/src/UserService.java",
      "range": {
        "start": { "line": 5, "character": 0 },
        "end": { "line": 50, "character": 1 }
      }
    }
  ],
  "elapsed": 300
}
```

## 位置参数说明

**传统方式（行列定位）：**
- `<file>`: Java 源文件路径（支持相对路径和绝对路径）
- `<line>`: 行号（从 1 开始，与 IDE 显示一致）
- `<col>`: 列号（从 1 开始，光标在符号上的位置）

**符号定位方式（推荐 AI 使用）：**
- `--method <name>`: 通过方法名自动定位
- `--symbol <name>`: 通过符号名自动定位（类、字段等）
- `--container <path>`: 指定父容器路径（用于嵌套符号、内部类、Lambda）
- `--signature <sig>`: 方法签名（用于区分重载方法）
- `--index <n>`: 同名符号索引（0-based）
- `--kind <type>`: 符号类型（Method, Field, Class, Interface...）
- `--global`: 全局定位，无需指定文件路径（v1.4.0+）

**提示：** 使用符号定位方式时，无需指定行列参数，工具会自动解析符号位置。

### 全局定位（v1.4.0+）

使用 `--global` 选项可在不知道文件路径的情况下定位方法，特别适合大型项目中快速查找符号。

**示例：**
```bash
# 全局搜索方法并获取定义
jls def --global --method processOrder

# 全局搜索方法的引用
jls refs --global --method UserService.findById

# 全局搜索方法的调用链
jls ch --global --method execute --depth 3

# 全局搜索接口实现
jls impl --global --symbol PaymentGateway.charge --kind Method

# 带签名消歧的全局定位
jls def --global --method process --signature "(String)" --index 0
```

**工作原理：**
1. 使用 `workspace/symbol` 搜索方法或包含该方法的类
2. 获取文件路径后，使用 `documentSymbol` 精确定位方法位置
3. 执行相应的 LSP 操作（定义、引用、调用链等）

**输出示例（多匹配消歧）：**
当有多个同名方法时，返回候选列表供选择：
```json
{
  "success": false,
  "error": "Found 3 matches for 'process'. Use --index to select.",
  "data": {
    "candidates": [
      {
        "index": 0,
        "name": "process",
        "kind": "Method",
        "container": "com.example.OrderService",
        "file": "/project/src/OrderService.java",
        "line": 25
      },
      {
        "index": 1,
        "name": "process",
        "kind": "Method",
        "container": "com.example.PaymentService",
        "file": "/project/src/PaymentService.java",
        "line": 48
      }
    ]
  }
}
```

**使用建议：**
- 唯一名称：直接使用 `--global --method methodName`
- 重载方法：添加 `--signature` 或 `--index` 消歧
- 大型项目：先用 `jls find` 预览所有匹配，再用 `--index` 精确定位

## 多项目支持（v1.4.0+）

守护进程模式支持同时管理多个 Java 项目，通过配置 `maxProjects` 启用。适合多模块项目或需要频繁切换项目的场景。

### 配置多项目

编辑 `~/.jdt-lsp-cli/config.json`：

```json
{
  "daemon": {
    "maxProjects": 3,           // 最大同时活跃项目数（>1 启用多项目模式）
    "perProjectMemory": "1g",   // 每项目内存限制
    "idleTimeoutMinutes": 30    // 空闲超时（分钟），0=不超时
  }
}
```

### 项目优先级配置（可选）

为重要项目设置高优先级，避免被 LRU 淘汰：

```json
{
  "projects": {
    "/path/to/core-project": {
      "priority": 10,           // 高优先级（值越大越不容易被淘汰）
      "jvmConfig": {
        "xmx": "2g"             // 该项目单独的 JVM 配置
      }
    },
    "/path/to/test-project": {
      "priority": 1             // 低优先级，可被淘汰
    }
  }
}
```

### 多项目命令

```bash
# 启动守护进程（自动启用多项目模式）
jls daemon start

# 预初始化多个项目（后台逐步加载）
jls daemon start --eager --project /path/to/project1
jls daemon start --eager --project /path/to/project2

# 查看所有已加载项目
jls daemon list

# 查看守护进程状态（包含项目列表）
jls daemon status

# 手动释放指定项目（回收内存）
jls daemon release /path/to/project

# 停止守护进程（释放所有项目）
jls daemon stop
```

### 项目管理策略

**LRU 淘汰机制：**
- 当活跃项目数达到 `maxProjects` 时，自动淘汰最久未访问的项目
- 优先级高的项目优先保留
- 同优先级时，淘汰最近最少使用的项目

**使用场景示例：**

```bash
# 场景 1：多模块 Maven 项目
# 父项目 + 多个子模块共享一个 JDT LS 实例
jls daemon start --eager --project /path/to/multi-module-project

# 场景 2：微服务架构
# 同时维护多个微服务项目，根据访问频率自动管理
jls ch /service-a/src/OrderService.java --method createOrder
jls ch /service-b/src/PaymentService.java --method processPayment
# 第三个项目访问时，可能淘汰最久未使用的项目
jls ch /service-c/src/NotificationService.java --method sendEmail

# 场景 3：核心项目常驻 + 临时项目按需加载
# 配置核心项目 priority=10，临时项目 priority=1
# 临时项目完成后手动释放，保留核心项目
jls daemon release /path/to/temp-project
```

**性能优化建议：**
- **小内存机器**：设置 `maxProjects: 1-2`，`perProjectMemory: "512m"`
- **中型项目**：设置 `maxProjects: 3`，`perProjectMemory: "1g"`
- **大型项目**：设置 `maxProjects: 5+`，`perProjectMemory: "2g"`，为核心项目配置高优先级

## 输出格式

所有命令输出 JSON 格式：

```json
{
  "success": true|false,
  "data": { ... },      // 成功时返回数据
  "error": "...",       // 失败时返回错误信息
  "elapsed": 1234       // 耗时（毫秒）
}
```

## 性能说明

- **首次运行**：JDT LS 需要索引整个项目，可能需要 30-60 秒
- **后续运行**：索引已缓存，通常 1-10 秒完成
- **大型项目**：建议适当增加 `--timeout` 值
- **调用链深度**：深度越大，耗时越长。建议从小深度开始（如 `-d 3`）

## 常见问题

### Q: 报错 "Cannot find eclipse.jdt.ls"
确保已安装 Red Hat Java 扩展。工具会自动在以下位置查找：
- `~/.vscode/extensions/redhat.java-*`
- `~/.qoder/extensions/redhat.java-*`

### Q: JDT LS 启动失败 (exit code 13)
这通常是 Java 版本问题。JDT LS 1.53+ 需要 Java 21+。工具会自动使用扩展内置的 Java 21 运行时。

### Q: 输出结果为空
- 检查文件路径是否正确
- 检查行列号是否准确指向符号位置
- 使用 `-v` 查看详细日志排查问题

## 开发

```bash
# 开发模式（监听文件变化）
npm run watch

# 编译
npm run build

# 全局链接（开发调试）
npm link
```

## 技术架构

```
jdt-lsp-cli
├── src/
│   ├── cli.ts            # 命令行入口
│   ├── daemon.ts         # 守护进程 HTTP 服务
│   ├── jdtClient.ts      # LSP 客户端核心 + JVM 配置
│   ├── symbolResolver.ts # 符号解析器（符号名称 → 位置）
│   ├── projectPool.ts    # 多项目管理器（v1.4.0+）
│   ├── types.ts          # 类型定义
│   └── index.ts          # 库导出
└── dist/                 # 编译输出
```

## 许可证

MIT
