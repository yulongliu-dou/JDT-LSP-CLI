# type-definition 命令 - 类型定义

跳转到变量或表达式的类型定义。

## 基本信息

- **命令**: `type-definition`
- **别名**: `typedef`
- **功能**: 从变量、方法返回值等跳转到其类型的定义位置

## 语法

```bash
jls type-definition [file] [line] [col] [options]
jls typedef [file] [line] [col] [options]
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

#### 调试选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--explain-empty` | 解释为什么返回空结果（用于调试） | `false` |

## 使用方式

### 方式 1: 跳转到字段类型

```bash
# 从字段跳转到其类型定义
jls typedef MyClass.java --symbol myField
```

### 方式 2: 跳转到方法返回值类型

```bash
# 从方法跳转到其返回值类型定义
jls typedef Service.java --method getUser
```

### 方式 3: 使用行列号

```bash
jls typedef MyClass.java 10 5
```

## 使用示例

### 示例 1: 跳转到字段类型

```bash
# 假设 configuration 字段的类型是 Configuration
jls typedef DefaultSqlSession.java --symbol configuration
```

**输出：**
```json
{
  "success": true,
  "data": [
    {
      "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/Configuration.java",
      "range": {
        "start": { "line": 30, "character": 0 },
        "end": { "line": 30, "character": 0 }
      }
    }
  ],
  "count": 1
}
```

### 示例 2: 接口方法返回空结果

```bash
# 接口方法的 type-definition 可能返回空
jls typedef SqlSession.java --method getConfiguration
```

**输出：**
```json
{
  "success": true,
  "data": {
    "locations": [],
    "count": 0,
    "error": "The received response has neither a result nor an error property."
  }
}
```

## 限制说明

### 已知限制

| 场景 | 结果 | 说明 |
|------|------|------|
| 接口方法声明 | ⚠️ 空结果 | 接口方法没有具体实现，JDT LS 无法解析返回类型 |
| 类字段 | ✅ 正常 | 可跳转到字段类型定义 |
| 类方法返回值 | ✅ 正常 | 可解析返回类型 |
| 基本类型 | ⚠️ 空结果 | `int`, `void` 等基本类型没有类型定义位置 |
| 泛型参数 | ⚠️ 可能为空 | 泛型类型参数可能无法解析 |

### 建议

1. **接口方法**: 使用 `definition` 命令代替，跳转到方法声明
2. **基本类型**: 基本类型没有类型定义，这是预期行为
3. **泛型**: 如果返回空，尝试具体化后的类型

## 选项详解

### --explain-empty

当返回空结果时，提供额外的解释信息（用于调试）。

```bash
jls typedef SqlSession.java --method getConfiguration --explain-empty
```

## 常见用例

### 查看字段的具体类型

```bash
# 1. 查看类的字段
jls sym MyClass.java --flat

# 2. 跳转到字段类型
jls typedef MyClass.java --symbol myField

# 3. 查看类型的定义
jls sym path/to/type.java --flat
```

### 理解方法返回类型

```bash
# 1. 查看方法签名
jls hover Service.java --method getUser

# 2. 跳转到返回类型定义
jls typedef Service.java --method getUser

# 3. 查看返回类型的结构
jls sym path/to/User.java --flat
```

## 与 definition 的区别

| 命令 | 功能 | 示例 |
|------|------|------|
| `definition` | 跳转到符号本身的定义 | `definition MyClass.java --method myMethod` → 方法声明位置 |
| `type-definition` | 跳转到符号类型的定义 | `type-definition MyClass.java --symbol myField` → 字段类型的类定义 |

## 注意事项

1. **JDT LS 限制**: 接口方法的类型定义可能无法解析
2. **基本类型**: 基本类型没有类型定义位置
3. **空结果处理**: 使用 `--explain-empty` 获取调试信息
4. **备选方案**: 如果 `type-definition` 返回空，尝试使用 `definition` 或 `hover`

## 相关命令

- [definition](definition.md) - 跳转到符号定义
- [hover](hover.md) - 获取符号的类型信息
- [symbols](symbols.md) - 获取文件中的所有符号
