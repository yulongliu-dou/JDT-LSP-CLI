# codeLens 复查报告

## 1. 基本信息

- **CLI 命令**：`jls code-lens <file>`（别名 `lens`），文件级命令（无符号定位）
- **LSP 方法**：`textDocument/codeLens`
- **LSP 返回类型**：`CodeLens[]`，每项 `{ range, command?, data? }`
- **语义**：获取文件中的代码透镜信息（如方法上的引用计数）
- **探路数据**：`test-output/explore/codeLens.json`（40 个 CodeLens，全部为 unresolved 状态，`data` 格式为 JDT LS 的 `[fileURI, position, "references"]`）
- **实现文件**：
  - CLI 层：`src/cli/commands/codeLens.ts`
  - 客户端：`src/jdt/client.ts:337-344`
  - 连接层：`src/jdt/lspConnection.ts:500-504`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:748-752`

## 2. 字段对照表

LSP CodeLens 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出 | 状态 | 备注 |
|-------------|---------|------|------|
| `range` | ✓透传 | ✓ | |
| `command?` | — | ✗缺失 | **CodeLens 未 resolve**——JDT LS 返回 unresolved lens，`command` 为 null。需 `codeLens/resolve` 获取实际命令 |
| `data?` | ✓透传 | ⚠ | JDT LS 自定义格式 `[fileURI, position, type]`，type 为 "references"，非 LSP 标准字段 |

### 2.1 探路数据格式

```json
{
  "range": { "start": {"line": 54, "character": 9}, "end": {"line": 54, "character": 26} },
  "data": ["file:///E:/.../DefaultSqlSession.java", {"line": 54, "character": 9}, "references"]
}
```

### 2.2 compact 字段分析

compact 字段：`['range.start.line', 'command.title']`

| 字段 | 实际值 | 状态 |
|------|-------|------|
| `range.start.line` | 54 ✓ | 有值 |
| `command.title` | undefined | **无意义**——未 resolve，command 为 null |

**结果**：compact 模式下每个 CodeLens 变成 `{ range.start.line: N }`——只有行号，无任何代码透镜信息，不可用。

## 3. JDT LS 行为偏差

无。

- JDT LS 返回 unresolved CodeLens（data 包含 lens 类型），符合 LSP spec（resolve 是可选的） ✓
- `data` 为 JDT LS 自定义格式，非 LSP 标准但属于 `any` 类型范畴 ✓

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| CodeLens 未 resolve | **P2** | LSP 的典型用法是：获取 CodeLens[] → 逐个 resolve 获取 command（含引用计数）。当前跳过 resolve，agent 拿不到 "3 references" 这类标题。只能从 `data` 推断出是 "references" 类型。可用性降级 |
| compact 字段无意义 | **P2** | `command.title` 始终 undefined（未 resolve）。compact 输出退化为仅行号列表——对 agent 无用。需要改为 `range.start.line + data[2]`（type 字段）才有意义 |
| `data` 格式非标准 | P3 | JDT LS 的 `data: [uri, pos, type]` 是自定义格式。agent 可解读但缺乏可移植性 |

### 4.2 跨命令影响

无。codeLens 输出仅供 agent 了解代码标注信息。

## 5. 修复方案

### 5.1 解析 JDT LS 的 `data` 字段

在输出前解析 JDT LS 的 `data` 格式，将其转换为可读结构：

```typescript
// data: ["file:///...", {line, character}, "references"]
// 转换为 → { fileUri, position, type: "references" }
```

### 5.2 修正 compact 字段

```typescript
codeLens: ['range.start.line', 'range.start.character', 'type'],
```

### 5.3 可选：实现 codeLens/resolve

在 daemon 端对 each lens 逐个 resolve 获取 command.title。需评估性能影响（40 个 lens × 逐个网络往返）。

### 5.4 涉及文件

- `src/cli/commands/codeLens.ts` 或 `src/daemon/routes/routeHandlers.ts` — data 解析
- `src/core/types.ts:579` — compact 字段

### 5.5 风险评估

低风险。data 格式解析仅影响输出格式。codeLens/resolve 可选（需评估性能）。
