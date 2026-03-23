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

# 检查状态
jls daemon status

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
| 索引缓存 | `~/.jdt-lsp-cli/data/<project-hash>/` |

## 命令概览

| 命令 | 简写 | 说明 |
|------|------|------|
| `call-hierarchy` | `ch` | 获取方法调用链（向下调用） |
| `definition` | `def` | 跳转到符号定义 |
| `references` | `refs` | 查找所有引用 |
| `symbols` | `sym` | 获取文件符号列表 |
| `implementations` | `impl` | 查找接口/抽象方法实现 |
| `hover` | - | 获取悬停信息（类型、文档） |

## 全局选项

```bash
jls [command] [options]

选项:
  -p, --project <path>    Java 项目根目录 (默认: 当前目录)
  --jdtls-path <path>     指定 eclipse.jdt.ls 路径 (可选)
  --data-dir <path>       JDT LS 数据目录 (可选)
  -v, --verbose           显示详细日志
  --timeout <ms>          操作超时时间 (默认: 60000)
  --no-daemon             禁用守护进程模式，每次命令重新启动 JDT LS
  -V, --version           显示版本号
  -h, --help              显示帮助信息
```

## 命令详解

### 1. call-hierarchy (ch) - 调用链分析

获取指定方法的调用链，分析方法调用了哪些其他方法。

```bash
jls ch <file> <line> <col> [options]

选项:
  -d, --depth <n>    最大递归深度 (默认: 5)
  --incoming         获取被调用关系（谁调用了我）
```

**示例：**
```bash
# 获取方法的向下调用链（深度3）
jls ch src/main/java/com/example/Service.java 25 10 -d 3

# 获取方法的被调用关系
jls ch src/main/java/com/example/Service.java 25 10 --incoming
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
jls def <file> <line> <col>
```

**示例：**
```bash
# 获取变量定义位置
jls def src/main/java/com/example/App.java 30 15
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
jls refs <file> <line> <col> [options]

选项:
  --no-declaration    不包含声明本身
```

**示例：**
```bash
# 查找方法的所有引用
jls refs src/main/java/com/example/UserService.java 15 20

# 不包含声明本身
jls refs src/main/java/com/example/UserService.java 15 20 --no-declaration
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
jls impl <file> <line> <col>
```

**示例：**
```bash
# 查找接口方法的所有实现
jls impl src/main/java/com/example/Repository.java 8 10
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
jls hover <file> <line> <col>
```

**示例：**
```bash
jls hover src/main/java/com/example/App.java 20 10
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

## 位置参数说明

- `<file>`: Java 源文件路径（支持相对路径和绝对路径）
- `<line>`: 行号（从 1 开始，与 IDE 显示一致）
- `<col>`: 列号（从 1 开始，光标在符号上的位置）

**提示：** 确保光标位置在符号名称上（如方法名、类名、变量名），而不是在括号或其他位置。

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
│   ├── cli.ts        # 命令行入口
│   ├── jdtClient.ts  # LSP 客户端核心
│   ├── types.ts      # 类型定义
│   └── index.ts      # 库导出
└── dist/             # 编译输出
```

## 许可证

MIT
