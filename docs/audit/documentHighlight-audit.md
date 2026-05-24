# documentHighlight 复查报告

## 1. 基本信息

- **CLI 命令**：`jls document-highlight [file]`（别名 `highlight`），支持符号定位
- **LSP 方法**：`textDocument/documentHighlight`
- **LSP 返回类型**：`DocumentHighlight[] | null`，每项 `{ range, kind? }`
- **语义**：查找同一文件内对某符号的所有引用位置，区分读（Read）/写（Write）/文本引用（Text）
- **探路数据**：`test-output/explore/documentHighlight.json`（仅 1 个结果——声明位置，kind=2 Read，结果正确）
- **实现文件**：
  - CLI 层：`src/cli/commands/documentHighlight.ts`
  - 客户端：`src/jdt/client.ts:328-335`
  - 连接层：`src/jdt/lspConnection.ts:492-498`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:741-746`

## 2. 字段对照表

LSP DocumentHighlight 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `range.start.line` | compact 保留 | ✓ | |
| `range.start.character` | compact 保留 | ✓ | |
| `kind?` | `kind` | ⚠偏差 | 输出为原始数字（1=Text, 2=Read, 3=Write），未映射为字符串名 |
| `range.end.line` | compact 缺 | P3 | 范围结束行/列在 compact 中丢失 |
| `range.end.character` | compact 缺 | P3 | 同上 |

Compact fields: `['kind', 'range.start.line', 'range.start.character']`

## 3. JDT LS 行为偏差

无。

- 在声明位置返回单结果 (kind=2 Read)，正确 ✓
- `kind` 按 LSP DocumentHighlightKind 枚举返回数字，符合规范 ✓

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| `kind` 未映射为字符串 | P2 信息缺失 | Agent 看到 `kind: 2` 而非 `kind: "Read"`。仅 3 个值，agent 可通过查表理解，但不符合自描述原则。对比 symbols 和 workspaceSearch 的 `kind` 均已做数字→字符串映射，此处不一致 |
| compact 缺 `range.end` | P3 轻微 | 高亮范围结束位置丢失。agent 仍可通过 `range.start` + `length` 推断 |

### 4.2 跨命令影响

无。documentHighlight 输出仅供 agent 了解文件内符号引用分布，不被其他命令消费。

## 5. 修复方案

### 5.1 Kind 映射

增加 DocumentHighlightKind 字符串映射：

```typescript
const DocumentHighlightKindMap: Record<number, string> = {
  1: 'Text',
  2: 'Read',
  3: 'Write',
};
```

在 CLI 层或 daemon 层输出前做转换。

### 5.2 涉及文件

- `src/core/utils/symbolKind.ts` 或新建映射 — kind 字符串转换
- `src/cli/commands/documentHighlight.ts` 或 `src/daemon/routes/routeHandlers.ts:741-746` — 应用映射

### 5.3 风险评估

低风险。仅增加数字→字符串转换。
