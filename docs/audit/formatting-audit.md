# formatting 复查报告

## 1. 基本信息

- **CLI 命令**：`jls formatting <file>`（别名 `fmt`），文件级命令
- **LSP 方法**：`textDocument/formatting`
- **LSP 返回类型**：`TextEdit[] | null`，每项 `{ range, newText }`
- **语义**：获取文件的格式化编辑列表
- **探路数据**：`test-output/explore/formatting.json`（多个 TextEdit——空格/换行调整）
- **实现文件**：
  - CLI 层：`src/cli/commands/formatting.ts`
  - 客户端：`src/jdt/client.ts:373-380`
  - 连接层：`src/jdt/lspConnection.ts:531-536`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:778-783`

## 2. 字段对照表

LSP TextEdit 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出 | compact | 状态 | 备注 |
|-------------|---------|---------|------|------|
| `range` | ✓ | ✓ (展开) | ✓ | 透传 |
| `newText` | ✓ | ✓ | ✓ | 透传 |
| `range.start.line` | — | ✓ | ✓ | |
| `range.start.character` | — | ✓ | ✓ | |
| `range.end` | ✓ | ✗缺失 | P3 | 范围结束位置在 compact 中丢失 |

Compact 字段：`['range.start.line', 'range.start.character', 'newText']`

## 3. JDT LS 行为偏差

无。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺 `range.end` | P3 轻微 | agent 可通过 `range.start` + `newText` 推断编辑范围 |

**无 P0/P1/P2 问题。**

### 4.2 跨命令影响

无。formatting 输出仅供 agent 了解格式化变更。

## 5. 修复方案

无需修复。实现完全正确。
