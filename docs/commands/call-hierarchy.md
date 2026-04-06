# call-hierarchy 命令 - 调用链分析

获取方法的调用层次结构（调用链）。

## 基本信息

- **命令**: `call-hierarchy`
- **别名**: `ch`
- **功能**: 分析方法调用关系，支持 outgoing（向下调用）和 incoming（被谁调用）

## 语法

```bash
jls call-hierarchy [file] [line] [col] [options]
jls ch [file] [line] [col] [options]
```

## 参数

### 位置参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `[file]` | string | ❌ | Java 文件路径（与 `--global` 互斥） |
| `[line]` | number | ❌ | 行号（1-based） |
| `[col]` | number | ❌ | 列号（1-based） |

### 选项

#### 符号定位选项

| 选项 | 说明 |
|------|------|
| `--method <name>` | 方法名定位（自动解析位置） |
| `--symbol <name>` | 符号名定位（自动解析位置） |
| `--container <path>` | 父容器路径，如 "MyClass.myMethod" |
| `--signature <sig>` | 方法签名（区分重载），如 "(String, int)" |
| `--index <n>` | 同名符号索引（0-based） |
| `--kind <type>` | 符号类型：Method, Field, Class, Interface |
| `--global` | ⚠️ 全局搜索（必须配合 `--symbol` 和 `--kind`） |

#### 调用链选项

| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--depth <n>` | `-d` | 最大递归深度 | `3` |
| `--incoming` | | 获取被调用关系（谁调用了我） | `false`（获取我调用了谁） |

#### AI 友好模式选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--mode <type>` | 查询模式：`legacy`、`lazy`、`snapshot`、`summary` | `legacy` |
| `--cursor <id>` | 游标 ID，用于 lazy 模式继续查询 | - |
| `--fetch-source <ids>` | 逗号分隔的方法 ID 列表，获取源码（lazy 模式） | - |
| `--expand-depth <ids>` | 逗号分隔的方法 ID 列表，展开子调用（lazy 模式） | - |
| `--snapshot-path <path>` | snapshot 模式的输出路径 | - |
| `--max-summary-depth <n>` | summary 模式的最大深度 | `2` |

## 运行模式

### 1. Legacy 模式（默认）

传统的调用链分析，返回完整的调用树。

```bash
jls ch MyClass.java --method myMethod -d 3
```

### 2. Lazy 模式

惰性加载模式，先返回顶层结果，按需加载更多。适合 AI Agent 逐步探索。

```bash
# 首次查询
jls ch MyClass.java --method myMethod --mode lazy -d 5

# 继续查询（使用返回的 cursor）
jls ch MyClass.java --method myMethod --mode lazy --cursor <cursor_id>

# 获取特定方法的源码
jls ch MyClass.java --method myMethod --mode lazy --fetch-source "method_id_1,method_id_2"

# 展开特定方法的子调用
jls ch MyClass.java --method myMethod --mode lazy --expand-depth "method_id_1"
```

### 3. Snapshot 模式

生成完整的调用链快照，包含源码和文件结构。

```bash
jls ch MyClass.java --method myMethod --mode snapshot --snapshot-path ./output
```

**输出结构：**
```
output/
├── snapshot.json      # 完整快照数据
├── summary.json       # 摘要信息
├── lazy.json          # 惰性查询状态
└── sources/           # 方法源码文件
    ├── entry.java
    ├── m1.java
    ├── m2.java
    └── m3.java
```

### 4. Summary 模式

返回调用链的文本摘要，适合快速理解。

```bash
jls ch MyClass.java --method myMethod --mode summary --max-summary-depth 2
```

## 使用示例

### 示例 1: 获取方法的调用链（outgoing）

```bash
jls -p E:\mybatis-3-master ch src\main\java\org\apache\ibatis\session\defaults\DefaultSqlSession.java --method selectOne --index 0 -d 3
```

**输出：**
```json
{
  "success": true,
  "data": {
    "entry": {
      "name": "selectOne(String) <T> : T",
      "kind": "Method",
      "detail": "org.apache.ibatis.session.defaults.DefaultSqlSession",
      "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/defaults/DefaultSqlSession.java",
      "range": {
        "start": { "line": 65, "character": 2 },
        "end": { "line": 65, "character": 11 }
      }
    },
    "calls": [
      {
        "depth": 0,
        "caller": "selectOne(String)",
        "callee": "selectOne(String, Object)",
        "location": { "uri": "...", "range": {...} },
        "kind": "Method"
      },
      {
        "depth": 1,
        "caller": "selectOne(String, Object)",
        "callee": "selectList(String, Object)",
        "location": { "uri": "...", "range": {...} },
        "kind": "Method"
      },
      {
        "depth": 2,
        "caller": "selectList(String, Object)",
        "callee": "selectList(String, Object, RowBounds)",
        "location": { "uri": "...", "range": {...} },
        "kind": "Method"
      }
    ],
    "totalMethods": 6
  },
  "elapsed": 227
}
```

### 示例 2: 获取被调用关系（incoming）

```bash
# 查找谁调用了 selectOne 方法
jls ch DefaultSqlSession.java --method selectOne --incoming -d 3
```

### 示例 3: 使用摘要模式快速理解

```bash
jls ch Service.java --method processOrder --mode summary
```

## 选项详解

### --depth, -d

控制调用链的递归深度。深度越大，返回的调用树越完整，但耗时越长。

```bash
# 只查看直接调用（深度 1）
jls ch MyClass.java --method myMethod -d 1

# 查看 3 层调用链（默认）
jls ch MyClass.java --method myMethod -d 3

# 查看更深的调用链
jls ch MyClass.java --method myMethod -d 5
```

### --incoming

默认获取 **outgoing calls**（我调用了谁）。使用 `--incoming` 获取 **incoming calls**（谁调用了我）。

```bash
# Outgoing: myMethod 调用了哪些方法
jls ch MyClass.java --method myMethod

# Incoming: 哪些方法调用了 myMethod
jls ch MyClass.java --method myMethod --incoming
```

### --mode

选择不同的查询模式，适应不同的使用场景。

| 模式 | 适用场景 | 特点 |
|------|----------|------|
| `legacy` | 传统调用链分析 | 返回完整调用树 |
| `lazy` | AI Agent 逐步探索 | 惰性加载，按需获取 |
| `snapshot` | 完整存档 | 生成快照文件和源码 |
| `summary` | 快速理解 | 返回文本摘要 |

## 注意事项

1. **性能**: 深度越大，耗时越长。建议从 `d 3` 开始
2. **方法定位**: 必须定位到具体方法，不能是类或字段
3. **JDT 限制**: 某些虚拟方法或编译生成的方法可能无法分析
4. **递归调用**: 会自动检测并避免无限递归
5. **AI 友好模式**: 推荐使用 `lazy` 或 `summary` 模式，更适合 Agent 使用

## 常见用例

### 分析代码影响范围

```bash
# 查看方法调用了哪些底层方法
jls ch Service.java --method criticalMethod -d 5
```

### 追溯调用来源

```bash
# 查看哪些地方调用了这个方法
jls ch Service.java --method processOrder --incoming -d 3
```

### AI Agent 工作流

```bash
# 1. 获取调用链摘要
jls ch Service.java --method process --mode summary

# 2. 使用 lazy 模式探索
jls ch Service.java --method process --mode lazy -d 5

# 3. 按需获取源码
jls ch Service.java --method process --mode lazy --fetch-source "method_id_1"

# 4. 生成完整快照
jls ch Service.java --method process --mode snapshot --snapshot-path ./analysis
```

## 相关命令

- [references](references.md) - 查找符号的所有引用
- [definition](definition.md) - 跳转到符号定义
- [implementations](implementations.md) - 查找接口的实现
