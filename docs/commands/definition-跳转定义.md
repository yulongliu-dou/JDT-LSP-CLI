# definition 命令 - 跳转定义

获取符号的定义位置。

## 基本信息

- **命令**: `definition`
- **别名**: `def`
- **功能**: 获取变量、方法、类等符号的定义位置

## 语法

```bash
jls definition [file] [line] [col] [options]
jls def [file] [line] [col] [options]
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

### 方式 1: 使用行列号定位

```bash
jls def src/main/java/com/example/MyClass.java 10 5
```

### 方式 2: 使用符号名定位（推荐）

```bash
# 定位方法
jls def MyClass.java --method myMethod

# 定位字段
jls def MyClass.java --symbol myField

# 定位同名方法中的第一个
jls def MyClass.java --method myMethod --index 0
```

### 方式 3: 使用签名区分重载方法

```bash
# 定位特定签名的方法
jls def MyClass.java --method myMethod --signature "(String, int)"
```

### 方式 4: 全局定位

```bash
# 全局搜索类定义
jls def --global --symbol ArrayList --kind Class

# 全局搜索接口定义
jls def --global --symbol Runnable --kind Interface
```

## 选项详解

### --method

通过方法名自动定位，无需手动提供行列号。

```bash
# 定位 selectOne 方法
jls def SqlSession.java --method selectOne
```

### --symbol

通过符号名定位（适用于方法、字段、类等）。

```bash
# 定位字段
jls def MyClass.java --symbol myField

# 定位类
jls def MyClass.java --symbol InnerClass
```

### --container

指定父容器路径，用于定位嵌套符号。

```bash
# 定位 MyClass.myMethod 方法
jls def MyClass.java --method myMethod --container MyClass
```

### --signature

通过方法签名精确匹配重载方法。

```bash
# 定位签名为 (String) 的方法
jls def MyClass.java --method process --signature "(String)"

# 定位签名为 (String, int) 的方法
jls def MyClass.java --method process --signature "(String, int)"
```

### --index

当有多个同名符号时，使用索引选择（0-based）。

```bash
# 获取第一个 selectOne 方法
jls def SqlSession.java --method selectOne --index 0

# 获取第二个 selectOne 方法（重载）
jls def SqlSession.java --method selectOne --index 1
```

### --global

跨整个工作区搜索符号定义。**必须同时提供 `--symbol` 和 `--kind`**。

```bash
# ✅ 正确用法
jls def --global --symbol ArrayList --kind Class
jls def --global --symbol Runnable --kind Interface

# ❌ 错误用法（缺少 --kind）
jls def --global --symbol MyClass
```

## 使用示例

### 示例 1: 使用符号名定位方法

```bash
jls -p E:\mybatis-3-master def src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne --index 0
```

**输出：**
```json
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

### 示例 2: 全局定位类

```bash
jls def --global --symbol SqlSessionManager --kind Class
```

### 示例 3: 处理歧义

当存在多个匹配时，返回候选列表：

```bash
jls def SqlSession.java --method selectOne
```

**输出（歧义错误）：**
```json
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

**解决方法：**
```bash
# 使用 --index 选择
jls def SqlSession.java --method selectOne --index 0

# 或使用 --signature 指定签名
jls def SqlSession.java --method selectOne --signature "(String)"
```

## 三级精度匹配

| 级别 | 方式 | 适用场景 |
|------|------|----------|
| L1 | 仅名称 | 无重载、名称唯一 |
| L2 | 名称+签名 | 有重载方法 |
| L3 | 名称+索引 | 签名复杂或无法识别 |

## 注意事项

1. **行列号**: 行列号从 1 开始（不是 0）
2. **全局搜索限制**: `--global` 必须配合 `--symbol` 和 `--kind` 使用
3. **JDT LS 限制**: 主要支持类级别的全局搜索，方法级别可能受限
4. **歧义处理**: 存在多个匹配时，使用 `--index` 或 `--signature` 消歧
5. **泛型类型**: 签名中的泛型参数可能无法完全匹配，建议使用 `--index`

## 常见用例

### 查找方法的定义

```bash
# 1. 获取文件符号列表
jls sym MyClass.java --flat

# 2. 定位方法定义
jls def MyClass.java --method myMethod --index 0
```

### 查找类的定义位置

```bash
# 全局搜索类
jls def --global --symbol UserService --kind Class
```

### 查找字段类型的定义

```bash
# 1. 定位字段
jls def MyClass.java --symbol myField

# 2. 使用 type-definition 跳转到字段类型
jls typedef MyClass.java --symbol myField
```

## 相关命令

- [references](references.md) - 查找符号的所有引用
- [type-definition](type-definition.md) - 跳转到类型定义
- [hover](hover.md) - 获取符号的悬停信息
- [implementations](implementations.md) - 查找接口的实现
