# signatureHelp 复查报告

## 1. 基本信息

- **CLI 命令**：`jls signature-help [file]`（别名 `sig`），支持符号定位
- **LSP 方法**：`textDocument/signatureHelp`
- **LSP 返回类型**：`SignatureHelp | null`，顶层含 `signatures[]` + `activeSignature?` + `activeParameter?`
- **语义**：在方法调用处获取参数签名说明（参数名、类型、当前激活参数、Javadoc）
- **探路数据**：`test-output/explore/signatureHelp.json`（空 `signatures: []`——METHOD_POS 在方法声明处而非调用处，结果正确）
- **实现文件**：
  - CLI 层：`src/cli/commands/signatureHelp.ts`
  - 客户端：`src/jdt/client.ts:355-362`
  - 连接层：`src/jdt/lspConnection.ts:515-521`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:762-766`

## 2. 字段对照表

LSP SignatureHelp 规范字段 vs CLI 输出：

### 2.1 顶层字段

| LSP 原始字段 | CLI 输出 | 状态 | 备注 |
|-------------|---------|------|------|
| `signatures[]` | `signatures[]` | ✓一致 | compact 模式下每个项按 `['label', 'parameters']` 过滤 |
| `activeSignature?` | 透传 | ✓一致 | 完整模式透传；compact 模式 `...data` 展开保留 ✓ |
| `activeParameter?` | 透传 | ✓一致 | 同上 ✓ |

### 2.2 SignatureInformation 字段

| LSP 原始字段 | CLI compact | 状态 | 备注 |
|-------------|------------|------|------|
| `label` | ✓保留 | ✓ | 签名标签（如 `"selectOne(String statement) : T"`） |
| `parameters` | ✓保留 | ✓ | 参数数组完整保留（含每个参数的 label + documentation） |
| `documentation?` | **✗缺失** | P2 | Javadoc 方法说明在 compact 中丢失。label 只给出签名形式，documentation 告诉 agent 方法语义 |
| `activeParameter?` | ✗缺失 | P3 | 当前签名中激活的参数索引 |

## 3. JDT LS 行为偏差

无。

- 空结果（`signatures: []`）在非调用处位置正确 ✓
- 探路数据无法验证实际签名内容（需在方法调用处触发），但数据格式符合 LSP 规范 ✓

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺 `documentation` | P2 信息缺失 | signatureHelp 的核心价值是告诉 agent "这个方法签名是什么 + 方法做什么"。`label` 只给出签名形式（参数类型+名称），`documentation` 给出 Javadoc 语义说明。缺少 documentation 迫使 agent 再调用 hover 获取文档——多一次往返，违反原则 4（单次调用倾向） |
| compact 缺 `activeParameter` (per-signature) | P3 轻微 | 标记当前签名中的激活参数位置，用于 UI 高亮。对 agent 场景价值有限 |

### 4.2 跨命令影响

无。signatureHelp 是纯信息查询命令。

## 5. 修复方案

### 5.1 扩展 compact 字段

```typescript
signatureHelp: ['label', 'parameters', 'documentation'],
```

### 5.2 涉及文件

- `src/core/types.ts:581` — `COMPACT_FIELDS.signatureHelp`

### 5.3 风险评估

低风险。仅一行 compact 字段变更。
