# completion 复查报告

## 1. 基本信息

- **CLI 命令**：`jls completion [file]`（别名 `complete`），支持符号定位
- **LSP 方法**：`textDocument/completion`
- **LSP 返回类型**：`CompletionList | CompletionItem[] | null`
- **语义**：获取指定位置的代码补全候选列表
- **探路数据**：`test-output/explore/completion.json`（40+ 补全项——Object 方法覆写候选，格式完整）
- **实现文件**：
  - CLI 层：`src/cli/commands/completion.ts`
  - 客户端：`src/jdt/client.ts:346-353`
  - 连接层：`src/jdt/lspConnection.ts:507-513`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:754-760`

## 2. 字段对照表

LSP CompletionItem 核心字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出 | compact | 状态 | 备注 |
|-------------|---------|---------|------|------|
| `label` | ✓ | ✓ | ✓ | "clone() : Object" |
| `kind` | ✓ | ✓ | ⚠ | 输出为数字（2），未映射为 "Method" |
| `detail` | ✓ | ✓ | ✓ | "Override method in 'Object'" |
| `textEdit` | ✓ | ✗缺失 | P3 | 实际插入内容+位置，体积大 |
| `documentation` | ✓ | ✗缺失 | P3 | Javadoc，可单独调 hover |
| `sortText` / `filterText` | ✓ | ✗缺失 | ✓合理 | 客户端排序用，agent 不需要 |
| `tags?` | ✓ | ✗缺失 | P3 | deprecated 标记（CompletionItemTag: 1=Deprecated） |
| `command?` | ✓ | ✗缺失 | P3 | onDidSelect 回调，agent 场景不需要 |

### 2.1 顶层字段

| LSP 原始字段 | CLI 输出 | 状态 | 备注 |
|-------------|---------|------|------|
| `isIncomplete` | **✗缺失** | **P2** | daemon 和 CLI 层层 `result?.items` 提取丢失了此标志。`isIncomplete: true` 提示 agent 结果不完整需细化查询 |

Compact 字段：`['label', 'kind', 'detail']`

## 3. JDT LS 行为偏差

无。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| `isIncomplete` 丢失 | **P2 信息缺失** | LSP 规范：当选结果过多（如 workspace 级别的类名补全），服务器设置 `isIncomplete: true`。Agent 拿到结果后以为列表是完整的，做错误决策（如随机选一个而不是加更多前缀后重试） |
| `kind` 未字符串映射 | P2 | `kind: 2` vs `kind: "Method"`。CompletionItemKind 有 25 个值，与 SymbolKind (26 个值) 不同。实现不一致——symbols 已做映射 |

### 4.2 跨命令影响

无。completion 输出仅供 agent 选择补全项。

## 5. 修复方案

### 5.1 保留 `isIncomplete`

```typescript
// daemon 端
const result = await activeClient.getCompletion(...);
const items = result?.items || result || [];
return { 
  items: Array.isArray(items) ? items : [], 
  count: Array.isArray(items) ? items.length : 0,
  isIncomplete: result?.isIncomplete ?? false
};
```

### 5.2 Kind 映射

```typescript
// 新增 CompletionItemKind 映射
const CompletionItemKindMap: Record<number, string> = {
  1: 'Text', 2: 'Method', 3: 'Function', 4: 'Constructor', ...
};
```

### 5.3 涉及文件

- `src/cli/commands/completion.ts:52-53` — 保留 isIncomplete
- `src/daemon/routes/routeHandlers.ts:757-759` — 同上
- 新增 CompletionItemKind 映射 + 在输出前转换

### 5.4 风险评估

低风险。`isIncomplete` 保留不改变现有数据结构。kind 映射仅影响输出格式。
