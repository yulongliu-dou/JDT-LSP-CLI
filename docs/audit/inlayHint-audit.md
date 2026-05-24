# inlayHint 复查报告

## 1. 基本信息

- **CLI 命令**：`jls inlay-hint [file]`（别名 `inlay`），支持符号定位
- **LSP 方法**：`textDocument/inlayHint`
- **LSP 返回类型**：`InlayHint[] | null`，每项 `{ position, label, kind?, tooltip?, ... }`
- **语义**：获取编译器推断的类型标注和参数名提示
- **探路数据**：`test-output/explore/inlayHint.json`（空数组——方法声明处无推断类型，结果正确）
- **实现文件**：
  - CLI 层：`src/cli/commands/inlayHint.ts`
  - 客户端：`src/jdt/client.ts:310-317`
  - 连接层：`src/jdt/lspConnection.ts:475-481`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:727-732`

## 2. 字段对照表

LSP InlayHint 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出 | compact | 状态 | 备注 |
|-------------|---------|---------|------|------|
| `position` | ✓ | ✓ (展开) | ✓ | |
| `label` | ✓ | ✓ | ✓ | |
| `kind?` | ✓ | ✗缺失 | P2 | 1=Type（类型推断如 `var x` → `String`），2=Parameter（参数名标注）。agent 需要区分 |
| `tooltip?` | ✓ | ✗缺失 | P3 | |
| `textEdits?` | ✓ | ✗缺失 | P3 | |

Compact 字段：`['label', 'position.line', 'position.character']`

## 3. JDT LS 行为偏差

无。空结果在无推断类型的位置正确。

**注意**：探路数据为空，无法验证有 hint 时的实际字段完整性。建议用含 `var` 声明或方法调用的文件验证。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺 `kind` | P2 | agent 看到 `label: "String"` 但不知道是类型提示还是参数名。kind=1 表示 "这是 var 的类型推断"，kind=2 表示 "这是调用处的参数名标注"——两种场景的下一步操作不同 |

**无 P0/P1 问题。**

### 4.2 跨命令影响

无。

## 5. 修复方案

### 5.1 扩展 compact 字段

```typescript
inlayHint: ['label', 'kind', 'position.line', 'position.character'],
```

### 5.2 涉及文件

- `src/core/types.ts:576` — `COMPACT_FIELDS.inlayHint`

### 5.3 风险评估

低风险。
