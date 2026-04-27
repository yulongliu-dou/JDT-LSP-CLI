# hover 命令 - 悬停信息

获取符号的类型信息和文档注释。

## 基本信息

- **命令**: `hover`
- **功能**: 获取符号的类型签名、Javadoc 文档等悬停信息

## 语法

```bash
jls hover [file] [line] [col] [options]
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

## 使用方式

### 方式 1: 使用行列号

```bash
jls hover MyClass.java 10 5
```

### 方式 2: 使用符号名（推荐）

```bash
# 获取方法的悬停信息
jls hover MyClass.java --method myMethod

# 获取字段的悬停信息
jls hover MyClass.java --symbol myField
```

## 使用示例

### 示例 1: 获取方法的悬停信息

```bash
jls -p E:\mybatis-3-master hover src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne --index 0
```

**输出：**
```json
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

**输出说明：**
- `contents[0]`: 方法签名（带语法高亮）
- `contents[1]`: Javadoc 文档（Markdown 格式）
- `contents[2]`: 源码位置信息

### 示例 2: 获取字段的悬停信息

```bash
jls hover MyClass.java --symbol myField
```

### 示例 3: 获取类的悬停信息

```bash
jls hover MyClass.java --symbol MyClass
```

## 输出格式

`hover` 命令返回的 `contents` 是一个数组，包含多个部分：

1. **类型签名**: 第一个元素通常包含 `language` 和 `value` 字段
2. **文档注释**: 第二个元素是 Javadoc 文档（如果有）
3. **源码信息**: 最后一个元素是源码位置

## 注意事项

1. **contents 为数组**: 返回的 `contents` 是数组格式，不是单个对象
2. **Javadoc 依赖**: 只有存在 Javadoc 注释时才会返回文档内容
3. **符号定位**: 建议使用 `--method` 或 `--symbol` 避免手动指定行列号
4. **性能**: 悬停信息获取通常很快（< 500ms）

## 常见用例

### 查看方法签名和文档

```bash
# 获取方法的完整签名和 Javadoc
jls hover Service.java --method processOrder
```

### 查看字段类型

```bash
# 获取字段的类型信息
jls hover MyClass.java --symbol myField
```

### AI Agent 集成

```bash
# 获取方法的签名和文档，用于代码理解
jls hover --json-compact MyClass.java --method myMethod
```

## 相关命令

- [跳转定义](definition-跳转定义.md) - 跳转到符号定义
- [文档符号](symbols-文档符号.md) - 获取文件中的所有符号
- [查找引用](references-查找引用.md) - 查找符号的所有引用
