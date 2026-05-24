# typeDefinition 复查报告

## 1. 基本信息

- **CLI 命令**：`jls type-definition [file]`（别名 `typedef`），支持 `--explain-empty` 调试选项
- **LSP 方法**：`textDocument/typeDefinition`
- **语义**：从变量/字段跳转到其声明类型的定义（如 `Executor executor` → `Executor` 接口）
- **探路数据**：`test-output/explore/typeDefinition.json`（空数组——JDT LS 1.58.0 已知 bug，见下）
- **实现文件**：
  - CLI 层：`src/cli/commands/typeDefinition.ts`
  - 客户端：`src/jdt/client.ts:216-233`
  - 连接层：`src/jdt/lspConnection.ts:297-314`（**含 JDT LS bug 降级处理**）
  - 守护进程：`src/daemon/routes/routeHandlers.ts:965-995`

## 2. 字段对照表

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `uri` | `uri` | ✓一致 | 透传 |
| `range.start.line` | compact 有 | ✓ | |
| `range.start.character` | compact **缺** | **✗缺失** | **P1**：与 references/implementations 相同的遗漏 |

### 2.1 `--explain-empty` 响应格式

正常模式返回 `Location[]`，`--explain-empty` 模式返回 `{ locations: [], explanation: "..." }` —— 格式不一致，但作为调试选项可接受。

## 3. JDT LS 行为偏差

**已知严重 Bug**：JDT LS 1.58.0 对 `textDocument/typeDefinition` 的响应不符合 JSON-RPC 2.0 规范（有 `id` 但缺少 `result`/`error` 封装），vscode-jsonrpc 库正确拒绝该响应。

**降级处理已实现**：`lspConnection.ts:307-313` 捕获该特定错误消息（`neither a result nor an error`），记录日志并返回 `[]`。这是正确的自愈策略。

**后果**：typeDefinition 始终返回空数组，无法获得真实类型定义数据。需等 JDT LS 上游修复。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| compact 缺 `range.start.character` | **P1** | 与 references/implementations 相同模式（即使当前 JDT LS 返回空，修复后仍会暴露） |
| 直接模式缺 URI 重写 | P1 | 同上 |
| JDT LS 响应格式 bug | **已知约束** | 已通过 try/catch 降级处理，返回 `[]`。**非本项目问题**——需等 JDT LS 上游修复。`--explain-empty` 提供调试信息 |

### 4.2 跨命令影响

typeDefinition 输出格式为 `Location[]`，与 definition/references/implementations 一致，是变量/字段到其声明类型的导航入口。被后续命令消费：
- **hover**（Layer 3）：获取类型定义处文档
- **definition**（Layer 2）：跳转到类型定义位置
- **references**（Layer 2）：查找类型的所有引用

列号缺失影响同 references。**注**：JDT LS 1.58.0 bug 导致返回始终为空，此跨命令影响在当前 JDT 版本下不可观测。

## 5. 修复方案

### 5.1 compact 字段

```typescript
typeDefinition: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
typedef: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
```

### 5.2 涉及文件

- `src/core/types.ts:566-567` — compact 字段

### 5.3 JDT LS bug 状态

JDT LS 1.58.0 bug 无修复时间线。降级处理已就绪，功能可正常使用（结果为空）。修复后将自动获得正确数据。

### 5.4 风险评估

低风险。compact 修改不影响现有降级逻辑。JDT LS bug 修复后即可正常工作。
