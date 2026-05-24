# hover 复查报告

## 1. 基本信息

- **CLI 命令**：`jls hover [file]`，支持符号定位
- **LSP 方法**：`textDocument/hover`
- **LSP 返回类型**：`Hover | null`，`contents: MarkupContent | MarkedString | MarkedString[]`
- **语义**：获取符号的 Javadoc 文档和类型签名信息
- **探路数据**：`test-output/explore/hover.json`（selectOne 方法，含代码签名 + Javadoc + 源文件链接）
- **实现文件**：
  - CLI 层：`src/cli/commands/hover.ts`
  - 客户端：`src/jdt/client.ts:192-199`
  - 连接层：`src/jdt/lspConnection.ts:265-274`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:640-652`

## 2. 字段对照表

LSP Hover 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `contents` | `contents` | ✓一致 | 直接透传。JDT LS 返回混合数组：MarkupContent（Java 签名）+ MarkedString（Javadoc 文本 + Markdown 源链接） |
| `range?` | — | — | JDT LS 不返回此字段（探路数据 typeSummary keys 仅 `["contents"]`），无可输出 |

Compact 字段：`['contents']` — 仅一个字段，对 hover 的语义完全足够。

## 3. JDT LS 行为偏差

无。

- `contents` 返回混合格式：代码块（`{ language: "java", value }`）+ 文本（`string`）—— 符合 LSP 规范 ✓
- Javadoc 包含类型参数、参数说明、返回值说明 —— JDT LS 标准行为 ✓
- 源文件链接以 Markdown 格式嵌入 —— JDT LS 扩展，对 agent 有价值 ✓

**探路数据中 contents 结构验证**：
1. `{ language: "java", value: "<T> T ...selectOne(String statement)" }` — 方法签名
2. `"Retrieve a single row mapped from the statement key. ..."` — Javadoc 描述
3. `"Source: *[mybatis](file:///E:/...DefaultSqlSession.java#67)*"` — 源文件链接（Markdown）

## 4. 影响面评估

### 4.1 本命令影响

无 P0/P1/P2 问题。hover 是纯信息查询命令，返回数据完全透传，无需 URI 重写（不返回 Location），compact 字段已足够。

### 4.2 跨命令影响

无。hover 输出为纯文本/文档信息，不被其他命令消费。

## 5. 修复方案

无需修复。实现完全正确。
