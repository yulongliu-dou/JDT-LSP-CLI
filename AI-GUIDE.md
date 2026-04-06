# jdt-lsp-cli AI Agent 核心使用指南

> 本指南专为 AI Agent 设计,提供渐进式文档访问:核心工作流 → 命令索引 → 详细文档

## 🎯 核心工作流:代码理解闭环

AI Agent 理解 Java 代码的完整路径:

```bash
# 第1步:定位目标方法
jls def MyClass.java --method myMethod --index 0

# 第2步:分析调用链(AI核心命令)
jls ch MyClass.java --method myMethod --mode lazy -d 5

# 第3步:按需获取源码
jls ch MyClass.java --method myMethod --mode lazy --fetch-source "method_id_1"

# 第4步:查找引用(影响范围)
jls refs MyClass.java --method myMethod

# 第5步:生成完整快照(可选)
jls ch MyClass.java --method myMethod --mode snapshot --snapshot-path ./output
```

## 🔑 核心命令速查

### 1. call-hierarchy (调用链分析) - ⭐ AI最常用

**用途**: 理解方法调用关系、代码影响范围、追溯调用来源

```bash
# 基础用法:获取调用链
jls ch <file> --method <name> -d 3

# AI推荐:使用lazy模式逐步探索
jls ch <file> --method <name> --mode lazy -d 5

# 获取被谁调用(incoming)
jls ch <file> --method <name> --incoming -d 3

# 按需加载源码
jls ch <file> --method <name> --mode lazy --fetch-source "id1,id2"

# 生成完整快照
jls ch <file> --method <name> --mode snapshot --snapshot-path ./output
```

**详细文档**: [commands/call-hierarchy.md](docs/commands/call-hierarchy.md)

### 2. definition (跳转定义)

**用途**: 定位符号(方法/字段/类)的定义位置

```bash
# 定位方法
jls def MyClass.java --method myMethod --index 0

# 全局搜索类
jls def --global --symbol ClassName --kind Class

# 使用签名区分重载
jls def MyClass.java --method myMethod --signature "(String, int)"
```

**详细文档**: [commands/definition.md](docs/commands/definition.md)

### 3. references (查找引用)

**用途**: 查找符号的所有使用位置,分析影响范围

```bash
# 查找方法引用
jls refs MyClass.java --method myMethod

# 排除声明本身
jls refs MyClass.java --method myMethod --no-declaration

# 全局查找类引用
jls refs --global --symbol ClassName --kind Class
```

**详细文档**: [commands/references.md](docs/commands/references.md)

### 4. hover (获取符号信息)

**用途**: 获取符号的类型、签名、文档等元信息

```bash
jls hover MyClass.java --method myMethod
```

**详细文档**: [commands/hover.md](docs/commands/hover.md)

## 📚 完整命令索引目录

当核心命令不满足需求时,查阅以下完整索引:

### 符号导航类

| 命令 | 别名 | 用途 | 文档链接 |
|------|------|------|----------|
| `definition` | `def` | 跳转到符号定义 | [详细说明](docs/commands/definition.md) |
| `references` | `refs` | 查找符号的所有引用 | [详细说明](docs/commands/references.md) |
| `type-definition` | `typedef` | 跳转到类型定义 | [详细说明](docs/commands/type-definition.md) |
| `implementations` | `impl` | 查找接口实现 | [详细说明](docs/commands/implementations.md) |
| `hover` | `hover` | 获取符号悬停信息 | [详细说明](docs/commands/hover.md) |
| `symbols` | `sym` | 列出文件中的所有符号 | [详细说明](docs/commands/symbols.md) |

### 调用分析类

| 命令 | 别名 | 用途 | 文档链接 |
|------|------|------|----------|
| `call-hierarchy` | `ch` | 调用链分析(核心) | [详细说明](docs/commands/call-hierarchy.md) |

### 搜索类

| 命令 | 别名 | 用途 | 文档链接 |
|------|------|------|----------|
| `find` | `find` | 工作区符号搜索 | [详细说明](docs/commands/find.md) |

### 系统管理类

| 命令 | 别名 | 用途 | 文档链接 |
|------|------|------|----------|
| `daemon` | `daemon` | 守护进程管理 | [详细说明](docs/commands/daemon.md) |
| `config` | `config` | 配置管理 | [详细说明](docs/commands/config.md) |

### 全局选项

所有命令共享的全局选项: [global-options.md](docs/global-options.md)

## 🤖 AI Agent 最佳实践

### 场景1:理解一个方法的作用

```bash
# 1. 获取方法定义
jls def Service.java --method processOrder

# 2. 查看调用链(outgoing)
jls ch Service.java --method processOrder --mode summary

# 3. 深入分析关键调用
jls ch Service.java --method processOrder --mode lazy -d 3

# 4. 获取关键方法源码
jls ch Service.java --method processOrder --mode lazy --fetch-source "method_id"
```

### 场景2:分析方法被谁调用

```bash
# 1. 获取incoming调用链
jls ch Service.java --method processOrder --incoming --mode lazy -d 3

# 2. 查找所有引用
jls refs Service.java --method processOrder
```

### 场景3:重构前的影响分析

```bash
# 1. 获取完整调用链
jls ch Service.java --method oldMethod --mode snapshot --snapshot-path ./analysis

# 2. 查找所有引用
jls refs Service.java --method oldMethod

# 3. 查看实现类(如果是接口方法)
jls impl Interface.java --method myMethod
```

### 场景4:理解代码结构

```bash
# 1. 列出文件所有符号
jls sym MyClass.java --flat

# 2. 定位关键方法
jls def MyClass.java --method keyMethod --index 0

# 3. 分析调用关系
jls ch MyClass.java --method keyMethod -d 3
```

## 💡 常用选项说明

### 符号定位选项(所有导航命令通用)

- `--method <name>`: 方法名定位
- `--symbol <name>`: 符号名定位
- `--signature <sig>`: 方法签名,如 `"(String, int)"`
- `--index <n>`: 同名符号索引(0-based)
- `--global`: 全局搜索(需配合`--symbol`和`--kind`)
- `--kind <type>`: 符号类型:`Method`, `Field`, `Class`, `Interface`

### 调用链模式选项

- `--mode legacy`: 传统模式,返回完整调用树(默认)
- `--mode lazy`: **AI推荐**,惰性加载,按需探索
- `--mode snapshot`: 生成完整快照文件
- `--mode summary`: 返回文本摘要,快速理解
- `-d, --depth <n>`: 递归深度,建议从3开始
- `--incoming`: 查询被调用关系(谁调用了我)

## ⚠️ 注意事项

1. **路径格式**: Windows使用反斜杠`src\Main.java`,Linux使用正斜杠`src/Main.java`
2. **行列号**: 从1开始(不是0)
3. **性能**: 深度越大耗时越长,建议从`-d 3`开始
4. **歧义处理**: 多个同名符号时使用`--index`或`--signature`消歧
5. **全局搜索**: `--global`必须配合`--symbol`和`--kind`

## 📖 渐进式文档访问

```
AI-GUIDE.md (本文档)
  ├── 核心工作流 (上面介绍的代码理解闭环)
  ├── 核心命令速查 (4个最常用命令)
  ├── 完整命令索引 (所有命令的快速查找表)
  └── 详细文档链接 (点击跳转到 docs/commands/*.md)
        ├── call-hierarchy.md (调用链详解)
        ├── definition.md (跳转定义详解)
        ├── references.md (查找引用详解)
        └── ... (其他命令详细文档)
```

## 🚀 快速开始

```bash
# 基本命令格式
jls -p <项目路径> <命令> [参数] [选项]

# 示例
jls -p E:\my-project ch src\Service.java --method processOrder --mode lazy -d 3
```

---

**需要更多帮助?**
- 查看完整命令文档: [docs/commands/](docs/commands/)
- 查看全局选项: [docs/global-options.md](docs/global-options.md)
