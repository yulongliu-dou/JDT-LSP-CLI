# prepareRename 复查报告

## 1. 基本信息

- **CLI 命令**：`jls prepare-rename [file]`（别名 `preren`），支持符号定位
- **LSP 方法**：`textDocument/prepareRename`
- **LSP 返回类型**：`Range | { range: Range, placeholder: string } | { defaultBehavior: boolean } | null`
- **语义**：检查位置是否可重命名，返回可重命名的符号范围
- **探路数据**：`test-output/explore/prepareRename.json`（selectOne 方法声明位置返回 Range `{start: line 66 char 15, end: line 66 char 24}`，9 字符宽度正确）
- **实现文件**：
  - CLI 层：`src/cli/commands/prepareRename.ts`
  - 客户端：`src/jdt/client.ts:382-390`
  - 连接层：`src/jdt/lspConnection.ts:537-545`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:785-797`

## 2. 字段对照表

### 2.1 数据封装分析

JDT LS 返回 plain `Range`：`{ start: {line, character}, end: {line, character} }`

CLI 封装为：`{ range: <LSP响应>, valid: true }`

compact 字段：`['start.line', 'start.character', 'end.line', 'end.character']`

**实际数据路径**：`data.range.start.line`（封装在 `range` 键下）

**compact 查找路径**：`data.start.line`（缺少 `range.` 前缀）

| compact 字段 | 实际路径 | compact 查找路径 | 匹配 | 结果 |
|-------------|---------|-----------------|------|------|
| `start.line` | `data.range.start.line` | `data.start.line` | **✗不匹配** | undefined |
| `start.character` | `data.range.start.character` | `data.start.character` | **✗不匹配** | undefined |
| `end.line` | `data.range.end.line` | `data.end.line` | **✗不匹配** | undefined |
| `end.character` | `data.range.end.character` | `data.end.character` | **✗不匹配** | undefined |

**结论：compact 输出为空对象 `{}`——完全不可用。**

## 3. JDT LS 行为偏差

无。JDT LS 返回 plain `Range`，符合 LSP 规范。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 路径缺少 `range.` 前缀 | **P1 数据错误** | compact 模式下 prepareRename 输出为 `{}`。Agent 拿不到任何有效信息——不知道符号范围、不知道是否可重命名。`valid: true` 也在 compact 白名单之外被丢弃 |

### 4.2 跨命令影响

prepareRename 输出是 rename 命令的前提检查——agent 先调 prepareRename 确认可重命名，再调 rename 执行。compact 输出 `{}` 导致 agent 无法判断下一步。

## 5. 修复方案

### 5.1 修正 compact 字段路径

```typescript
prepareRename: ['range.start.line', 'range.start.character', 'range.end.line', 'range.end.character'],
preren: ['range.start.line', 'range.start.character', 'range.end.line', 'range.end.character'],
```

或添加 `valid` 字段：
```typescript
prepareRename: ['valid', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character'],
```

### 5.2 涉及文件

- `src/core/types.ts:586-587` — compact 字段修正

### 5.3 风险评估

低风险。仅修正字段路径，不涉及逻辑变更。
