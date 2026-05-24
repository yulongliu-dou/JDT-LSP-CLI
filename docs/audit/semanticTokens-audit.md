# semanticTokens 复查报告

## 1. 基本信息

- **CLI 命令**：`jls semantic-tokens [file]`（别名 `semtok`），支持 `--method`/`--symbol` 定位特定符号范围的 token
- **LSP 方法**：`textDocument/semanticTokens/full`
- **探路数据**：`test-output/explore/semanticTokens.json`（DefaultSqlSession.java 完整 token 序列）
- **实现文件**：
  - CLI 层：`src/cli/commands/semanticTokens.ts`
  - 连接层：`src/jdt/lspConnection.ts:449-458`（请求）、`129-145`（client capabilities）
  - 解码逻辑：`cli/commands/semanticTokens.ts:75-100`（`decodeSemanticTokens`）

## 2. 字段对照表

LSP SemanticTokens 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `resultId?` | `resultId` | ✓一致 | 正确保留，在顶层对象中返回，用于后续 delta 更新 |
| `data[]` (编码) | `tokens[]` (解码) | ✓一致 | delta 解码逻辑正确（line 的 delta==0 同行走增量，>0 换行置绝对值） |
| `data[tokenType]` | `tokens[].tokenType` | ✗缺失映射 | **P1**：输出值为原始数字（0, 1, 2...），未映射为字符串名。Agent 无法理解含义 |
| `data[tokenModifiers]` | `tokens[].tokenModifiers` | ✗缺失解码 | **P2**：输出为原始数字位掩码（如 4096, 4160），未解码为修饰符名称数组。Agent 无法理解 |
| `data[deltaLine]` | `tokens[].line` | ✓一致 | 正确解码为绝对行号 |
| `data[deltaStartChar]` | `tokens[].startChar` | ✓一致 | 正确解码 |
| `data[length]` | `tokens[].length` | ✓一致 | 正确透传 |

### 2.1 Token Type 映射缺失分析

探路数据验证：DefaultSqlSession.java 第 15 行 `package org.apache.ibatis.session.defaults;` 各段为 `tokenType: 0`（推测为 namespace），第 17 行 `import java.util.List;` 中 "List" 为 `tokenType: 2`（推测为 class）。当前输出仅为数字，agent 无法可靠推理。

Client capabilities 中向服务器声明了 23 种 token types（索引 0-22），但：
1. 服务器（JDT LS）实际使用的映射表在 `InitializeResult.capabilities.semanticTokensProvider.legend` 中
2. 当前 `initialize()` 方法（`lspConnection.ts:178`）**丢弃了 server 的 InitializeResult**，未保存服务器能力
3. 因此实现层根本没有 legend 数据可以用来做映射

### 2.2 Token Modifiers 位掩码分析

从探路数据看，`defaultLibrary` 修饰符值为 4096（= 2^12）。`4160 = 4096 + 64`。在 client capabilities 中，64 对应 bit 6（'async'），但修饰符位掩码的实际含义由**服务器** legend 确定（已被丢弃）。当前输出为原始位掩码数字，agent 完全无法解读。

## 3. JDT LS 行为偏差

**无偏差**。JDT LS 按 LSP 规范返回语义 token。

**已确认正确的部分**：
- 数据编码使用 delta 格式（相对位置），正确
- `resultId` 正确返回，可支持后续 delta 请求
- LSP 请求正确使用 `textDocument/semanticTokens/full`

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| `tokenType` 无字符串映射 | **P1 数据错误** | 命令的核心价值是告诉 agent "这个 token 是什么类型"。输出 `tokenType: 13` 对 agent 完全无用——必须额外查表才能知道 13 是 "method"。违背设计原则 2（失败可自愈：输出需直接可解析）和原则 3（携带下一步参数）。Agent 无法基于此输出做任何后续操作。 |
| `tokenModifiers` 位掩码未解码 | P2 信息缺失 | 修饰符位掩码 `4096` 本身不透明，且当前实现未解码为字符串数组。Agent 无法知道 token 是否为 deprecated/static/abstract/defaultLibrary。例如 defaultLibrary 标记可让 agent 跳过 JDK 符号的深入分析。 |
| compact 缺失 `tokenModifiers` | P2 信息缺失 | 即便在完整模式，tokenModifiers 也是原始数字。compact 模式直接丢弃该字段，双重损失。 |
| InitializeResult 被丢弃 | P2 设计缺失 | `lspConnection.ts:178` 没有保存服务器能力，导致永远无法获取 JDT LS 的真实 SemanticTokensLegend。这也是后续所有依赖 server capabilities 的功能（如 completion 的 trigger characters）的潜在问题。 |

### 4.2 跨命令影响

无直接跨命令影响。但 `InitializeResult` 被丢弃的问题会影响 **completion**（第 4 层，trigger characters 需从 server capabilities 读取）等依赖服务器能力的命令。

## 5. 修复方案

### 5.1 存储 Server Capabilities

在 `LspConnectionManager` 中增加 `serverCapabilities` 字段：

```typescript
// lspConnection.ts
private serverCapabilities: any = null;

async initialize(projectPath: string): Promise<void> {
  const result = await this.connection.sendRequest(InitializeRequest.type.method, initParams);
  this.serverCapabilities = result.capabilities;  // 保存
  // ...
}
```

### 5.2 解码 tokenType 和 tokenModifiers

在 `decodeSemanticTokens` 中使用 server legend 做名称解析：

```typescript
function decodeSemanticTokens(raw: any, legend: { tokenTypes: string[], tokenModifiers: string[] }) {
  // tokenType number → string name
  const tokenTypeName = legend.tokenTypes[tokenType] || `unknown(${tokenType})`;
  
  // tokenModifiers bitmask → string array
  const modifiers: string[] = [];
  for (let i = 0; i < legend.tokenModifiers.length; i++) {
    if (tokenModifiers & (1 << i)) {
      modifiers.push(legend.tokenModifiers[i]);
    }
  }
}
```

### 5.3 更新 compact 字段

```typescript
semanticTokens: ['line', 'startChar', 'length', 'tokenType', 'tokenModifiers'],
```

### 5.4 涉及文件

- `src/jdt/lspConnection.ts` — 存储 server capabilities 并暴露 legend
- `src/cli/commands/semanticTokens.ts` — 从 legend 做名称映射
- `src/core/types.ts:573-574` — compact 字段增加 `tokenModifiers`

### 5.5 风险评估

中等风险。存储 server capabilities 会影响 `initialize()` 返回值签名，需检查所有调用方。legend 依赖 JDT LS 的 InitializeResult 结构，需确认 JDT LS 实际返回的 legend 格式（可通过一次请求验证）。
