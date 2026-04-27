# implementations 命令 - 查找实现

查找接口或抽象方法的所有实现。

## 基本信息

- **命令**: `implementations`
- **别名**: `impl`
- **功能**: 查找接口、抽象类或抽象方法的具体实现

## 语法

```bash
jls implementations [file] [line] [col] [options]
jls impl [file] [line] [col] [options]
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

### 方式 1: 查找接口的实现

```bash
# 定位到接口定义
jls impl Runnable.java 10 10

# 使用符号名
jls impl Runnable.java --symbol Runnable
```

### 方式 2: 查找抽象方法的实现

```bash
# 查找抽象方法的所有实现
jls impl AbstractService.java --method doProcess
```

### 方式 3: 全局查找实现

```bash
# 全局查找接口的所有实现
jls impl --global --symbol Runnable --kind Interface
```

## 使用示例

### 示例 1: 查找接口的实现

```bash
jls -p E:\mybatis-3-master impl --global --symbol SqlSession --kind Interface
```

**输出：**
```json
{
  "success": true,
  "data": {
    "implementations": [
      {
        "uri": "file:///E:/mybatis-3-master/src/test/java/org/apache/ibatis/session/defaults/ExtendedSqlSession.java",
        "range": {
          "start": { "line": 20, "character": 13 },
          "end": { "line": 20, "character": 30 }
        }
      },
      {
        "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSessionManager.java",
        "range": {
          "start": { "line": 34, "character": 13 },
          "end": { "line": 34, "character": 32 }
        }
      },
      {
        "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/defaults/DefaultSqlSession.java",
        "range": {
          "start": { "line": 45, "character": 13 },
          "end": { "line": 45, "character": 32 }
        }
      }
    ],
    "count": 3
  },
  "elapsed": 25
}
```

### 示例 2: 查找方法的实现

```bash
# 查找抽象方法的实现
jls impl AbstractHandler.java --method handle
```

## 注意事项

1. **接口 vs 实现**: 可以对接口使用，也可以对抽象类使用
2. **全局搜索**: 使用 `--global` 可以在整个工作区查找实现
3. **必须指定 kind**: 全局搜索时必须提供 `--kind Interface` 或 `--kind Class`
4. **性能**: 查找实现通常很快（< 100ms）

## 常见用例

### 查找接口的所有实现类

```bash
# 1. 查找 Runnable 接口的所有实现
jls impl --global --symbol Runnable --kind Interface

# 2. 查看某个实现类的详情
jls sym path/to/implementation.java --flat
```

### 分析抽象方法的实现

```bash
# 查找抽象方法的所有具体实现
jls impl AbstractService.java --method execute
```

### 理解框架扩展点

```bash
# 查找框架接口的实现，了解如何扩展
jls impl --global --symbol Interceptor --kind Interface
```

## 相关命令

- [跳转定义](definition-跳转定义.md) - 跳转到符号定义
- [查找引用](references-查找引用.md) - 查找符号的所有引用
- [全局符号搜索](find-全局符号搜索.md) - 全局搜索符号
