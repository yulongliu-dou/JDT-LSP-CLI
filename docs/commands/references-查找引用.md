# references 命令 - 查找引用

查找符号在项目中的所有引用位置。

## 基本信息

- **命令**: `references`
- **别名**: `refs`
- **功能**: 查找变量、方法、类等符号的所有引用

## 语法

```bash
jls references [file] [line] [col] [options]
jls refs [file] [line] [col] [options]
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

#### 引用选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--no-declaration` | 不包含声明本身 | `false`（包含声明） |

## 使用方式

### 方式 1: 使用行列号

```bash
jls refs MyClass.java 10 5
```

### 方式 2: 使用符号名（推荐）

```bash
# 查找方法的所有引用
jls refs MyClass.java --method myMethod

# 查找字段的所有引用
jls refs MyClass.java --symbol myField
```

### 方式 3: 排除声明本身

```bash
# 只查找使用位置，不包含声明
jls refs MyClass.java --method myMethod --no-declaration
```

### 方式 4: 全局查找引用

```bash
# 全局查找类的所有引用
jls refs --global --symbol MyClass --kind Class
```

## 选项详解

### --no-declaration

默认情况下，引用列表包含符号的声明位置。使用此选项排除声明。

```bash
# 包含声明（默认）
jls refs MyClass.java --method myMethod

# 不包含声明
jls refs MyClass.java --method myMethod --no-declaration
```

### 符号定位选项

与 `definition` 命令相同，支持多种定位方式。详见 [definition 命令文档](definition.md)。

## 使用示例

### 示例 1: 查找方法的引用

```bash
jls -p E:\mybatis-3-master refs src\main\java\org\apache\ibatis\session\SqlSession.java --method selectOne --index 0
```

**输出：**
```json
{
  "success": true,
  "data": {
    "references": [
      {
        "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSession.java",
        "range": {
          "start": { "line": 43, "character": 8 },
          "end": { "line": 43, "character": 17 }
        }
      },
      {
        "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSessionManager.java",
        "range": {
          "start": { "line": 157, "character": 11 },
          "end": { "line": 157, "character": 20 }
        }
      },
      {
        "uri": "file:///E:/mybatis-3-master/src/test/java/org/apache/ibatis/session/SqlSessionTest.java",
        "range": {
          "start": { "line": 165, "character": 15 },
          "end": { "line": 165, "character": 24 }
        }
      }
    ],
    "count": 10
  },
  "elapsed": 178
}
```

### 示例 2: 排除声明

```bash
jls refs MyClass.java --method myMethod --no-declaration
```

### 示例 3: 查找类的引用

```bash
jls refs --global --symbol SqlSession --kind Class
```

## 注意事项

1. **性能**: 查找引用可能较慢，尤其是在大型项目中
2. **范围**: 默认在整个项目中搜索引用
3. **声明包含**: 默认结果包含符号的声明位置，使用 `--no-declaration` 排除
4. **符号定位**: 建议使用 `--method` 或 `--symbol` 避免手动指定行列号

## 常见用例

### 分析代码依赖

```bash
# 查找某个方法被哪些地方调用
jls refs UserService.java --method processOrder

# 查找某个类被哪些地方使用
jls refs --global --symbol User --kind Class
```

### 重构前检查

```bash
# 重命名方法前，检查所有引用
jls refs MyClass.java --method oldName --no-declaration
```

### 影响范围分析

```bash
# 1. 查找方法的所有引用
jls refs Service.java --method criticalMethod

# 2. 统计引用数量
jq '.data.count'

# 3. 获取引用文件列表
jq '.data.references[].uri'
```

## 相关命令

- [definition](definition.md) - 跳转到符号定义
- [implementations](implementations.md) - 查找接口的实现
- [call-hierarchy](call-hierarchy.md) - 分析调用链
