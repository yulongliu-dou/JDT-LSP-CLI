# JDT LSP CLI 使用文档 V2

> 全面测试验证版本 - 基于 MyBatis 3 项目实测

## 版本信息

- **版本**: 1.6.7
- **测试日期**: 2026-03-29
- **测试项目**: MyBatis 3 (1395+ Java 文件)
- **测试环境**: Windows 25H2, Node.js 18+

---

## 目录

1. [快速开始](#快速开始)
2. [守护进程管理](#守护进程管理)
3. [核心命令详解](#核心命令详解)
4. [符号定位功能](#符号定位功能)
5. [全局选项](#全局选项)
6. [输出格式](#输出格式)
7. [测试结果汇总](#测试结果汇总)
8. [已知限制](#已知限制)
9. [故障排除](#故障排除)

---

## 快速开始

### 安装

```bash
cd jdt-lsp-cli
npm install
npm run link
jls --version
```

### 启动守护进程（推荐）

```bash
# 启动守护进程并预初始化项目
jls daemon start --eager --init-project E:\mybatis-3-master

# 检查状态
jls daemon status
```

### 第一个查询

```bash
# 搜索类
jls -p E:\mybatis-3-master find SqlSession --kind Class --limit 5

# 获取文件符号
jls -p E:\mybatis-3-master sym src\main\java\org\apache\ibatis\session\SqlSession.java --flat
```

---

## 守护进程管理

### 命令概览

| 命令 | 说明 | 状态 |
|------|------|------|
| `jls daemon start` | 启动守护进程 | ✅ 测试通过 |
| `jls daemon stop` | 停止守护进程 | ✅ 测试通过 |
| `jls daemon status` | 查看状态 | ✅ 测试通过 |
| `jls daemon list` | 列出已加载项目 | ✅ 测试通过 |
| `jls daemon release [project]` | 释放项目内存 | ✅ 测试通过 |

### 启动选项

```bash
# 基础启动
jls daemon start

# 预初始化模式（推荐）
jls daemon start --eager --init-project /path/to/project

# 指定端口
jls daemon start --port 9876
```

### 实测示例

```bash
$ jls daemon status
Daemon status: RUNNING
PID: 7216
Port: 9876
Project: E:\mybatis-3-master
Status: ready
Uptime: 43s
```

---

## 核心命令详解

### 1. find (f) - 全局符号搜索

**功能**: 在整个工作区搜索符号

**语法**:
```bash
jls find <query> [options]
```

**选项**:
- `--kind <type>` - 按类型过滤 (Class, Method, Field, Interface)
- `--limit <n>` - 限制返回数量 (默认: 50)

**实测示例**:
```bash
$ jls -p E:\mybatis-3-master find SqlSession --kind Class --limit 3
{
  "success": true,
  "data": {
    "symbols": [
      {
        "name": "SqlSessionException",
        "kind": "Class",
        "location": { "uri": "file:///E:/mybatis-3-master/...", "range": {...} },
        "containerName": "org.apache.ibatis.session"
      },
      {
        "name": "SqlSessionManager",
        "kind": "Class",
        "containerName": "org.apache.ibatis.session"
      },
      {
        "name": "DefaultSqlSessionFactory",
        "kind": "Class",
        "containerName": "org.apache.ibatis.session.defaults"
      }
    ],
    "count": 3
  },
  "elapsed": 19
}
```

**状态**: ✅ 测试通过

---

### 2. symbols (sym) - 文档符号

**功能**: 获取文件中的所有符号（类、方法、字段等）

**语法**:
```bash
jls sym <file> [options]
```

**选项**:
- `--flat` - 扁平化输出（不保留层级）

**实测示例**:
```bash
$ jls -p E:\mybatis-3-master sym src\main\java\org\apache\ibatis\session\SqlSession.java --flat
{
  "success": true,
  "data": {
    "symbols": [
      { "name": "SqlSession", "kind": "Interface", "range": {...} },
      { "name": "selectOne(String) <T>", "kind": "Method", "parent": "SqlSession" },
      { "name": "selectList(String) <E>", "kind": "Method", "parent": "SqlSession" },
      ...
    ],
    "count": 32
  },
  "elapsed": 438
}
```

**状态**: ✅ 测试通过

---

### 3. definition (def) - 跳转定义

**功能**: 获取符号的定义位置

**语法**:
```bash
jls def [file] [line] [col] [options]
```

**符号定位选项**:
- `--method <name>` - 方法名定位
- `--symbol <name>` - 符号名定位
- `--signature <sig>` - 方法签名（区分重载）
- `--index <n>` - 同名符号索引
- `--global` - 全局搜索（需配合 `--kind`）

**实测示例**:

**方式1: 使用行列号**
```bash
jls def src\main\java\org\apache\ibatis\session\SqlSession.java 33 10
```

**方式2: 使用符号名（推荐）**
```bash
$ jls -p E:\mybatis-3-master def src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne --index 0
{
  "success": true,
  "data": [
    {
      "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSession.java",
      "range": {
        "start": { "line": 43, "character": 8 },
        "end": { "line": 43, "character": 17 }
      }
    }
  ],
  "elapsed": 5
}
```

**方式3: 全局定位**
```bash
jls def --global --symbol "ArrayList" --kind Class
```

**状态**: ✅ 测试通过

---

### 4. references (refs) - 查找引用

**功能**: 查找符号在项目中的所有引用

**语法**:
```bash
jls refs [file] [line] [col] [options]
```

**选项**:
- `--no-declaration` - 不包含声明本身
- 支持所有符号定位选项

**实测示例**:
```bash
$ jls -p E:\mybatis-3-master refs src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne --index 0
{
  "success": true,
  "data": {
    "references": [
      { "uri": "file:///.../SqlSession.java", "range": { "start": { "line": 43, ... } } },
      { "uri": "file:///.../SqlSessionManager.java", "range": { "start": { "line": 157, ... } } },
      { "uri": "file:///.../SqlSessionTest.java", "range": { "start": { "line": 165, ... } } },
      ...
    ],
    "count": 10
  },
  "elapsed": 178
}
```

**状态**: ✅ 测试通过

---

### 5. hover - 悬停信息

**功能**: 获取符号的类型信息和文档注释

**语法**:
```bash
jls hover [file] [line] [col] [options]
```

**实测示例**:
```bash
$ jls -p E:\mybatis-3-master hover src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne --index 0
{
  "success": true,
  "data": {
    "contents": [
      {
        "language": "java",
        "value": "<T> T org.apache.ibatis.session.SqlSession.selectOne(String statement)"
      },
      "Retrieve a single row mapped from the statement key.\n\n* **Type Parameters:**\n  * **\\<T\\>** the returned object type\n* **Parameters:**\n  * **statement** the statement\n* **Returns:**\n  * Mapped object",
      "Source: *[mybatis](file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSession.java#44)*"
    ]
  },
  "elapsed": 221
}
```

**状态**: ✅ 测试通过

---

### 6. call-hierarchy (ch) - 调用链分析

**功能**: 获取方法的调用链（向下调用）

**语法**:
```bash
jls ch [file] [line] [col] [options]
```

**选项**:
- `-d, --depth <n>` - 最大递归深度 (默认: 5)
- `--incoming` - 获取被调用关系（谁调用了我）

**实测示例**:
```bash
$ jls -p E:\mybatis-3-master ch src\main\java\org\apache\ibatis\session\defaults\DefaultSqlSession.java --method selectOne --index 0 -d 3
{
  "success": true,
  "data": {
    "entry": {
      "name": "selectOne(String) <T> : T",
      "kind": "Method",
      "detail": "org.apache.ibatis.session.defaults.DefaultSqlSession",
      "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/defaults/DefaultSqlSession.java",
      "range": { "start": { "line": 65, "character": 2 }, ... }
    },
    "calls": [
      { "depth": 0, "caller": "selectOne(String)", "callee": "selectOne(String, Object)", ... },
      { "depth": 1, "caller": "selectOne(String, Object)", "callee": "selectList(String, Object)", ... },
      { "depth": 2, "caller": "selectList(String, Object)", "callee": "selectList(String, Object, RowBounds)", ... },
      { "depth": 1, "caller": "selectOne(String, Object)", "callee": "TooManyResultsException(String)", ... }
    ],
    "totalMethods": 6
  },
  "elapsed": 227
}
```

**状态**: ✅ 测试通过

---

### 7. implementations (impl) - 查找实现

**功能**: 查找接口或抽象方法的所有实现

**语法**:
```bash
jls impl [file] [line] [col] [options]
```

**实测示例**:
```bash
$ jls -p E:\mybatis-3-master impl --global --symbol SqlSession --kind Interface
{
  "success": true,
  "data": {
    "implementations": [
      {
        "uri": "file:///E:/mybatis-3-master/src/test/java/org/apache/ibatis/session/defaults/ExtendedSqlSession.java",
        "range": { "start": { "line": 20, "character": 13 }, ... }
      },
      {
        "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSessionManager.java",
        "range": { "start": { "line": 34, "character": 13 }, ... }
      },
      {
        "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/defaults/DefaultSqlSession.java",
        "range": { "start": { "line": 45, "character": 13 }, ... }
      }
    ],
    "count": 3
  },
  "elapsed": 25
}
```

**状态**: ✅ 测试通过

---

### 8. type-definition (typedef) - 类型跳转

**功能**: 跳转到变量或表达式的类型定义

**语法**:
```bash
jls typedef [file] [line] [col] [options]
```

**选项**:
- `--explain-empty` - 解释为什么返回空结果

**限制说明**:

| 场景 | 结果 | 说明 |
|------|------|------|
| 接口方法声明 | 空结果 | 接口方法没有具体实现 |
| 类字段 | ✅ 正常 | 可跳转到类型定义 |
| 类方法返回值 | ✅ 正常 | 可解析返回类型 |

**实测示例**:
```bash
# 接口方法返回空（符合预期）
$ jls typedef src\main\java\org\apache\ibatis\session\SqlSession.java --method getConfiguration
{
  "success": true,
  "data": {
    "locations": [],
    "count": 0,
    "error": "The received response has neither a result nor an error property."
  }
}
```

**状态**: ⚠️ 部分受限（JDT LS 限制）

---

## 符号定位功能

### 三级精度匹配

| 级别 | 方式 | 适用场景 |
|------|------|----------|
| L1 | 仅名称 | 无重载、名称唯一 |
| L2 | 名称+签名 | 有重载方法 |
| L3 | 名称+索引 | 签名复杂或无法识别 |

### 歧义处理

当存在多个匹配时，返回候选列表：

```bash
$ jls def src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne
{
  "success": false,
  "error": "Found 2 symbols named 'selectOne'. Use --signature or --index to disambiguate.",
  "data": {
    "resolution_error": {
      "type": "ambiguous",
      "suggestions": {
        "overloadOptions": [
          "[0] selectOne [Method] - () : T",
          "[1] selectOne [Method] - () : T"
        ]
      }
    }
  }
}
```

### 全局定位

**要求**: 必须同时提供 `--symbol` 和 `--kind`

```bash
# ✅ 正确用法
jls def --global --symbol "ArrayList" --kind Class
jls impl --global --symbol "Runnable" --kind Interface

# ❌ 错误用法（缺少 --kind）
jls def --global --symbol "MyClass"
```

---

## 全局选项

### 选项列表

| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `-p, --project <path>` | | 项目根目录 | 当前目录 |
| `--jdtls-path <path>` | | JDT LS 路径 | 自动查找 |
| `--data-dir <path>` | | 数据目录 | 自动 |
| `-v, --verbose` | | 详细日志 | false |
| `--timeout <ms>` | | 超时时间 | 60000 |
| `--no-daemon` | | 禁用守护进程 | false |
| `--json-compact` | | 紧凑 JSON 输出 | false |
| `-V, --version` | | 显示版本 | |
| `-h, --help` | | 显示帮助 | |

### 紧凑输出模式

使用 `--json-compact` 减少输出体积：

**标准输出 vs 紧凑输出**:

```bash
# 标准输出
jls def ...
# 返回: uri, range (含 start 和 end)

# 紧凑输出
jls def ... --json-compact
# 返回: uri, range.start (仅 line 和 character)
```

**各命令紧凑字段**:

| 命令 | 保留字段 |
|------|----------|
| `definition` | `uri`, `range.start` |
| `references` | `uri`, `range.start.line` |
| `symbols` | `name`, `kind`, `range.start.line` |
| `call-hierarchy` | `entry`, `calls`, `totalMethods` |
| `hover` | `contents` |
| `implementations` | `uri`, `range.start.line` |
| `type-definition` | `uri`, `range.start.line` |

---

## 输出格式

### 标准响应结构

```json
{
  "success": true|false,
  "data": { ... },
  "error": "...",
  "elapsed": 1234,
  "metadata": { ... }
}
```

### 元数据字段

| 字段 | 说明 |
|------|------|
| `compactMode` | 是否为紧凑模式 |
| `childrenExcluded` | symbols 命令中 children 被省略 |
| `projectStatus` | 项目加载状态（多项目模式） |

### 错误响应结构

```json
{
  "success": false,
  "error": "Missing required option: --kind",
  "data": {
    "resolution_error": {
      "type": "missing_required_param",
      "message": "...",
      "requiredParams": ["--kind"],
      "providedParams": ["--symbol"],
      "usage": "...",
      "examples": [...]
    }
  }
}
```

**错误类型**:

| 类型 | 说明 |
|------|------|
| `missing_required_param` | 缺少必需参数 |
| `not_found` | 符号未找到 |
| `ambiguous` | 多个匹配需要消歧 |
| `invalid_query` | 查询参数无效 |

---

## 测试结果汇总

### 测试覆盖情况

| 命令 | 基础测试 | 符号定位 | 紧凑模式 | 边缘情况 | 状态 |
|------|----------|----------|----------|----------|------|
| `find` | ✅ | N/A | ✅ | ✅ | 通过 |
| `symbols` | ✅ | N/A | ✅ | ✅ | 通过 |
| `definition` | ✅ | ✅ | ✅ | ✅ | 通过 |
| `references` | ✅ | ✅ | ✅ | ✅ | 通过 |
| `hover` | ✅ | ✅ | N/A | ✅ | 通过 |
| `call-hierarchy` | ✅ | ✅ | N/A | ✅ | 通过 |
| `implementations` | ✅ | ✅ | ✅ | ✅ | 通过 |
| `type-definition` | ⚠️ | ✅ | ✅ | ⚠️ | 受限 |
| `daemon start/stop/status` | ✅ | N/A | N/A | ✅ | 通过 |
| `daemon list/release` | ✅ | N/A | N/A | ✅ | 通过 |
| `config show/path/defaults` | ✅ | N/A | N/A | ✅ | 通过 |

### 性能测试结果

| 模式 | 首次命令 | 后续命令 |
|------|----------|----------|
| 守护进程模式 | 30-60秒（启动+索引） | **5-500ms** |
| 直接模式 | 30-60秒 | 30-60秒 |

### 边缘情况测试结果

| 场景 | 预期结果 | 实际结果 | 状态 |
|------|----------|----------|------|
| 不存在的文件 | 错误提示 | "File not found" | ✅ |
| 超出范围的行号 | 错误提示 | "Line number exceeds file length" | ✅ |
| 无效的行号格式 | 错误提示 | "Invalid line number" | ✅ |
| 不存在的符号 | 错误提示 | "No class named 'X' found" | ✅ |
| 重载方法歧义 | 返回候选列表 | 返回 overloadOptions | ✅ |
| 缺少必需参数 | 结构化错误 | 返回 resolution_error | ✅ |
| 接口方法 type-definition | 空结果 | 空数组（符合预期） | ⚠️ |

---

## 已知限制

### 1. type-definition 命令限制

**接口方法返回空结果**:
- 原因: 接口方法没有具体实现，JDT LS 无法解析返回类型的定义位置
- 建议: 使用 `definition` 命令跳转到方法声明

**基本类型**:
- `int`, `void` 等基本类型没有类型定义位置

### 2. 全局定位限制

**必须提供 `--kind` 参数**:
```bash
# ❌ 错误
jls def --global --symbol "MyClass"

# ✅ 正确
jls def --global --symbol "MyClass" --kind Class
```

**JDT LS 主要支持类级别搜索**:
- 方法级别的全局搜索可能受限
- 建议先用 `find` 命令查找，再使用 `--index` 精确定位

### 3. 签名匹配限制

**泛型类型**:
- 签名中的泛型参数可能无法完全匹配
- 建议: 使用 `--index` 替代 `--signature`

---

## 故障排除

### 守护进程无法启动

**症状**: `jls daemon start` 无响应或报错

**解决**:
```bash
# 1. 检查端口占用
netstat -ano | findstr 9876

# 2. 强制停止后重启
jls daemon stop
jls daemon start

# 3. 查看日志
type %USERPROFILE%\.jdt-lsp-cli\daemon.log
```

### 命令返回空结果

**检查清单**:
1. 文件路径是否正确（相对路径基于 `--project`）
2. 行列号是否从 1 开始（不是 0）
3. 符号名称是否完全匹配（区分大小写）
4. 使用 `-v` 查看详细日志

### JDT LS 启动失败

**症状**: exit code 13

**原因**: Java 版本问题

**解决**: 工具会自动使用 Red Hat Java 扩展内置的 Java 21 运行时，确保扩展已安装。

### 性能问题

**症状**: 命令执行缓慢

**解决**:
1. 使用守护进程模式
2. 增加 `--timeout` 值
3. 减少 `call-hierarchy` 的 `--depth`
4. 调整 JVM 内存配置

---

## 配置说明

### 配置文件位置

```
Windows: C:\Users\<username>\.jdt-lsp-cli\config.json
Linux/Mac: ~/.jdt-lsp-cli/config.json
```

### 默认配置

```json
{
  "jvm": {
    "xms": "256m",
    "xmx": "2g",
    "useG1GC": true,
    "maxGCPauseMillis": 200,
    "useStringDeduplication": true,
    "softRefLRUPolicyMSPerMB": 50,
    "extraArgs": []
  },
  "daemon": {
    "port": 9876,
    "idleTimeoutMinutes": 30,
    "maxProjects": 1,
    "perProjectMemory": "1g"
  }
}
```

### 管理配置

```bash
# 创建默认配置
jls config init

# 查看当前配置
jls config show

# 查看配置路径
jls config path

# 查看默认 JVM 配置
jls config defaults
```

---

## 使用建议

### AI Agent 集成

1. **优先使用守护进程模式**: 响应时间从 30-60s 降低到 5-500ms
2. **使用符号定位**: 避免硬编码行列号
3. **处理歧义**: 当返回 `ambiguous` 错误时，使用 `--index` 选择
4. **使用紧凑模式**: 减少 token 消耗

### 典型工作流

```bash
# 1. 启动守护进程
jls daemon start --eager --init-project /path/to/project

# 2. 搜索目标类
jls find UserService --kind Class

# 3. 获取类的方法列表
jls sym src/.../UserService.java --flat

# 4. 分析方法调用链
jls ch src/.../UserService.java --method processOrder -d 3

# 5. 查找方法实现
jls impl src/.../OrderService.java --method createOrder

# 6. 获取方法文档
jls hover src/.../OrderService.java --method createOrder
```

---

## 附录

### 符号类型对照表

| 类型值 | 名称 | 说明 |
|--------|------|------|
| 5 | Class | 类 |
| 6 | Method | 方法 |
| 8 | Field | 字段 |
| 10 | Interface | 接口 |
| 11 | Constructor | 构造函数 |
| 12 | Enum | 枚举 |
| 13 | Package | 包 |

### 相关链接

- [Eclipse JDT LS](https://github.com/eclipse/eclipse.jdt.ls)
- [Red Hat Java Extension](https://marketplace.visualstudio.com/items?itemName=redhat.java)
- [LSP Specification](https://microsoft.github.io/language-server-protocol/)

---

*文档版本: 2.0.0*
*最后更新: 2026-03-29*
*测试项目: MyBatis 3*
