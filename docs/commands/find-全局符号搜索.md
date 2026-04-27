# find 命令 - 全局符号搜索

在整個工作區中搜索符號（類、方法、字段、接口等）。

## 基本信息

- **命令**: `find`
- **别名**: `f`
- **功能**: 跨整個工作區搜索符號

## 語法

```bash
jls find <query> [options]
jls f <query> [options]
```

## 參數

### 位置參數

| 參數 | 類型 | 必需 | 說明 |
|------|------|------|------|
| `<query>` | string | ✅ | 搜索關鍵字（符號名稱） |

### 選項

| 選項 | 說明 | 默认值 |
|------|------|--------|
| `--kind <type>` | 按符號類型過濾 | 無過濾 |
| `--limit <n>` | 限制返回結果數量 | `50` |

## 選項詳解

### --kind

按符號類型過濾搜索結果。支持的類型：

- `Class` - 類
- `Method` - 方法
- `Field` - 字段
- `Interface` - 接口
- `Enum` - 枚舉
- `Constructor` - 構造函數

```bash
# 搜索所有包含 "Session" 的類
jls find Session --kind Class

# 搜索所有名為 "execute" 的方法
jls find execute --kind Method

# 搜索所有包含 "Config" 的接口
jls find Config --kind Interface
```

### --limit

限制返回結果的數量，避免輸出過大。

```bash
# 只返回前 5 個結果
jls find My --kind Class --limit 5

# 返回最多 100 個結果
jls find test --kind Method --limit 100
```

## 使用示例

### 示例 1: 搜索類

```bash
jls -p E:\mybatis-3-master find SqlSession --kind Class --limit 3
```

**輸出：**
```json
{
  "success": true,
  "data": {
    "symbols": [
      {
        "name": "SqlSessionException",
        "kind": "Class",
        "location": {
          "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/exceptions/SqlSessionException.java",
          "range": {
            "start": { "line": 20, "character": 13 },
            "end": { "line": 20, "character": 33 }
          }
        },
        "containerName": "org.apache.ibatis.exceptions"
      },
      {
        "name": "SqlSessionManager",
        "kind": "Class",
        "location": {
          "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/SqlSessionManager.java",
          "range": {
            "start": { "line": 34, "character": 13 },
            "end": { "line": 34, "character": 32 }
          }
        },
        "containerName": "org.apache.ibatis.session"
      },
      {
        "name": "DefaultSqlSessionFactory",
        "kind": "Class",
        "location": {
          "uri": "file:///E:/mybatis-3-master/src/main/java/org/apache/ibatis/session/defaults/DefaultSqlSessionFactory.java",
          "range": {
            "start": { "line": 27, "character": 13 },
            "end": { "line": 27, "character": 41 }
          }
        },
        "containerName": "org.apache.ibatis.session.defaults"
      }
    ],
    "count": 3
  },
  "elapsed": 19
}
```

### 示例 2: 搜索方法

```bash
jls -p E:\mybatis-3-master find selectOne --kind Method --limit 5
```

### 示例 3: 模糊搜索

```bash
# 搜索所有包含 "Config" 的符號
jls find Config --limit 10
```

## 注意事項

1. **搜索範圍**: `find` 命令在整個工作區（項目）中搜索，不限於單個文件
2. **模糊匹配**: 搜索關鍵字會進行模糊匹配，不需要完全匹配
3. **性能**: 大型項目首次搜索可能需要索引時間，後續搜索會更快
4. **JDT LS 限制**: 主要支持類級別搜索，方法級別搜索可能受限

## 常見用例

### 查找類的定義位置

```bash
# 1. 搜索類
jls find UserService --kind Class --limit 5

# 2. 獲取結果中的 URI，即可查看定義位置
```

### 查找所有實現某接口的類

```bash
# 1. 先找到接口
jls find Runnable --kind Interface

# 2. 使用 implementations 命令查找實現
jls impl --global --symbol Runnable --kind Interface
```

### 批量查找方法

```bash
# 查找所有名為 "init" 的方法
jls find init --kind Method --limit 100
```

## 相關命令

- [symbols](symbols.md) - 獲取單個文件中的所有符號
- [definition](definition.md) - 跳轉到符號定義
- [implementations](implementations.md) - 查找接口/方法的實現
