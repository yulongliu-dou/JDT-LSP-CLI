# symbols 命令 - 文档符号

获取指定 Java 文件中的所有符号（类、方法、字段等）。

## 基本信息

- **命令**: `symbols`
- **别名**: `sym`
- **功能**: 获取文件中的所有符号及其层次结构

## 语法

```bash
jls symbols <file> [options]
jls sym <file> [options]
```

## 参数

### 位置参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `<file>` | string | ✅ | Java 文件路径（绝对路径或相对于 `--project` 的路径） |

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--flat` | 扁平化输出（不保留层级关系） | `false` |

## 选项详解

### --flat

默认情况下，`symbols` 命令会返回符号的层次结构（类包含方法和字段）。使用 `--flat` 选项会将所有符号扁平化为列表。

```bash
# 层次化输出（默认）
jls sym MyClass.java

# 扁平化输出
jls sym MyClass.java --flat
```

## 使用示例

### 示例 1: 获取文件的符号层次结构

```bash
jls -p E:\mybatis-3-master sym src\main\java\org\apache\ibatis\session\SqlSession.java
```

**输出（层次化）：**
```json
{
  "success": true,
  "data": {
    "symbols": [
      {
        "name": "SqlSession",
        "kind": "Interface",
        "detail": "org.apache.ibatis.session",
        "range": {
          "start": { "line": 20, "character": 0 },
          "end": { "line": 200, "character": 0 }
        },
        "children": [
          {
            "name": "selectOne(String) <T>",
            "kind": "Method",
            "detail": "T",
            "range": {
              "start": { "line": 43, "character": 4 },
              "end": { "line": 43, "character": 50 }
            }
          },
          {
            "name": "selectList(String) <E>",
            "kind": "Method",
            "detail": "List<E>",
            "range": {
              "start": { "line": 55, "character": 4 },
              "end": { "line": 55, "character": 55 }
            }
          }
        ]
      }
    ]
  },
  "elapsed": 438
}
```

### 示例 2: 获取扁平化符号列表

```bash
jls -p E:\mybatis-3-master sym src\main\java\org\apache\ibatis\session\SqlSession.java --flat
```

**输出（扁平化）：**
```json
{
  "success": true,
  "data": {
    "symbols": [
      { "name": "SqlSession", "kind": "Interface", "detail": "org.apache.ibatis.session", "range": {...}, "parent": undefined },
      { "name": "selectOne(String) <T>", "kind": "Method", "detail": "T", "range": {...}, "parent": "SqlSession" },
      { "name": "selectList(String) <E>", "kind": "Method", "detail": "List<E>", "range": {...}, "parent": "SqlSession" },
      { "name": "selectMap(String, String)", "kind": "Method", "detail": "Map<K,V>", "range": {...}, "parent": "SqlSession" },
      { "name": "insert(String)", "kind": "Method", "detail": "int", "range": {...}, "parent": "SqlSession" },
      { "name": "update(String)", "kind": "Method", "detail": "int", "range": {...}, "parent": "SqlSession" },
      { "name": "delete(String)", "kind": "Method", "detail": "int", "range": {...}, "parent": "SqlSession" },
      { "name": "commit()", "kind": "Method", "detail": "void", "range": {...}, "parent": "SqlSession" },
      { "name": "close()", "kind": "Method", "detail": "void", "range": {...}, "parent": "SqlSession" }
    ],
    "count": 32
  },
  "elapsed": 438
}
```

### 示例 3: 使用绝对路径

```bash
jls sym E:\mybatis-3-master\src\main\java\org\apache\ibatis\session\SqlSession.java --flat
```

## 符号类型

| 类型值 | 名称 | 说明 |
|--------|------|------|
| 5 | Class | 类 |
| 6 | Method | 方法 |
| 8 | Field | 字段 |
| 10 | Interface | 接口 |
| 11 | Constructor | 构造函数 |
| 12 | Enum | 枚举 |
| 13 | Package | 包 |

## 注意事项

1. **文件路径**: 文件路径可以是相对于 `--project` 的路径，也可以是绝对路径
2. **文件存在性**: 如果文件不存在，会返回错误
3. **层次结构**: 默认输出保留符号的父子关系（类包含方法和字段）
4. **扁平化**: 使用 `--flat` 时，每个符号会包含 `parent` 字段指示其父符号

## 常见用例

### 查看类的所有方法

```bash
# 获取类的方法列表
jls sym src/main/java/com/example/UserService.java --flat

# 过滤出方法（在后处理中）
jq '.data.symbols[] | select(.kind == "Method")'
```

### 分析文件结构

```bash
# 查看文件的完整符号层次
jls sym src/main/java/com/example/MyClass.java
```

### 快速定位符号

```bash
# 1. 获取符号列表
jls sym MyClass.java --flat

# 2. 找到目标符号的行号

# 3. 使用 definition 或 hover 命令查看详细信息
jls def MyClass.java --method myMethod --index 0
```

## 相关命令

- [find](find.md) - 全局搜索符号
- [definition](definition.md) - 跳转到符号定义
- [hover](hover.md) - 获取符号的悬停信息
