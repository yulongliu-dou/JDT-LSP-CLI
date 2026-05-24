# codeAction 复查报告

## 1. 基本信息

- **CLI 命令**：`jls code-action [file]`（别名 `action`），支持符号定位
- **LSP 方法**：`textDocument/codeAction`
- **LSP 返回类型**：`(Command | CodeAction)[] | null`
- **语义**：获取指定位置的可用重构和快速修复操作列表
- **探路数据**：`test-output/explore/codeAction.json`（返回 1 项：`Change signature for 'DefaultSqlSession'`，JDT LS 返回 `Command` 类型）
- **实现文件**：
  - CLI 层：`src/cli/commands/codeAction.ts`
  - 客户端：`src/jdt/client.ts:319-326`
  - 连接层：`src/jdt/lspConnection.ts:483-490`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:734-739`

## 2. 字段对照表

JDT LS 实际返回 `Command[]` 对象（非 `CodeAction[]`）：

| LSP Command 字段 | CLI 输出 | compact | 状态 | 备注 |
|-----------------|---------|---------|------|------|
| `title` | ✓ | ✓ | ✓ | "Change signature for 'DefaultSqlSession'" |
| `command` | ✓ | **✗缺失** | **P2** | 机器可读命令标识（如 `java.action.applyRefactoringCommand`），compact 中丢失。agent 需要此字段判断可执行的操作类型 |
| `arguments` | ✓ | ✗缺失 | P2 | 命令的具体参数（含重构类型、目标位置），compact 中丢失 |

Compact 字段：`['title', 'kind']`

**⚠ 注意**：`kind` 是 `CodeAction` 的字段（如 `quickfix`、`refactor`），但 JDT LS 实际返回 `Command` 类型（无 `kind`）。compact 中包含 `kind` 对 JDT LS 返回的数据毫无意义——每次都是 `undefined`。

## 3. JDT LS 行为偏差

无。JDT LS 对 codeAction 请求返回 `Command[]`（非 `CodeAction[]`），符合 LSP 规范——服务器可选择返回任一种格式。

**注意事项**：
- 请求中 `context.diagnostics` 固定为 `[]`，意味着 JDT LS 不会返回基于诊断的快速修复（如 "Add import"、"Surround with try-catch"）。仅返回通用重构操作
- 探路数据仅有 1 个重构建议（Change signature），表明该位置（方法声明）下可用操作有限

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺 `command` | **P2** | `command` 是机器可读的操作标识符（如 `java.action.applyRefactoringCommand`）。Agent 仅看到 `title: "Change signature for 'DefaultSqlSession'"` 无法编程化判断这是哪种操作。`command` 是 agent 决策的关键字段 |
| compact 缺 `arguments` | P2 | arguments 包含重构类型（如 `"changeSignature"`）和目标位置。Agent 需要这些参数来执行/请求用户确认操作 |
| compact `kind` 无意义 | P3 | JDT LS 返回 Command（无 kind），compact 中 kind 始终为 undefined。字段不造成错误但无用 |
| `context.diagnostics` 硬编码为空 | P3 | 设计简化，agent 无法获取诊断触发的快速修复（如缺失 import 的补全建议） |

### 4.2 跨命令影响

无。codeAction 输出仅列出可用操作，不被其他命令消费。

## 5. 修复方案

### 5.1 修正 compact 字段

将 `kind` 替换为 `command`，增加 `arguments`：

```typescript
codeAction: ['title', 'command', 'arguments'],
```

注意：`arguments` 包含嵌套对象（如 textDocument, range 等），体积较大。折中方案：仅 `['title', 'command']`。

### 5.2 涉及文件

- `src/core/types.ts:577` — `COMPACT_FIELDS.codeAction`

### 5.3 风险评估

低风险。compact 字段变更，不影响逻辑。
