# declaration 复查报告

## 1. 基本信息

- **CLI 命令**：`jls declaration [file]`（别名 `decl`），支持符号定位
- **LSP 方法**：`textDocument/declaration`
- **语义**：从实现位置跳转到接口/抽象声明位置（如 DefaultSqlSession.selectOne → SqlSession.selectOne）
- **探路数据**：`test-output/explore/declaration.json`（正确跳转到 SqlSession.java:43 的接口声明）
- **实现文件**：
  - CLI 层：`src/cli/commands/declaration.ts`
  - 客户端：`src/jdt/client.ts:364-370`
  - 连接层：`src/jdt/lspConnection.ts:523-529`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:770-776`

## 2. 字段对照表

LSP Location 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `uri` | `uri` | ✓一致 | 透传 |
| `range` | `range` | ✓一致 | 透传 |
| `originalUri` | — | ✗缺失 | **daemon 也未重写**，jdt:// URI 原样返回 |
| `source` | — | ✗缺失 | 同上 |
| `lineMapping` | — | ✗缺失 | 同上 |

Compact 字段 (`declaration`/`decl`)：`['uri', 'range.start.line', 'range.start.character']`——仅 3 个字段，对比 definition 的 9 个缩减显著。

## 3. JDT LS 行为偏差

无。声明跳转语义正确——DefaultSqlSession.selectOne() 正确跳转到 SqlSession 接口的 selectOne 声明（SqlSession.java:43）。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| **Daemon 模式也缺少 URI 重写** | **P1 数据错误** | `handleDeclaration`（routeHandlers.ts:773-775）未调用 `rewriteLocation/rewriteLocations`。对比 definition 的 `handleDefinition` 有完整重写逻辑，declaration 两边都缺。对 JDK 接口声明的声明跳转（如 `class MyList implements List` → `java.util.List` 接口）返回原始 jdt:// URI，agent 无法使用。**影响比 definition 更严重——daemon 模式也不能正常工作。** |
| 直接模式缺少 URI 重写 | P1 数据错误 | 同 definition，直接模式 jdt:// URI 问题 |
| compact 字段过少 | P2 信息缺失 | 只保留 3 个基础字段。definition 的 compact 有 9 个字段（含 enriched 扩展）。即便将来URI重写修复了，enriched 字段也会在 compact 中丢失。 |

### 4.2 跨命令影响

与 definition 同级的第 2 层命令，declaration 输出的 `{ uri, range }` 与 definition 享有完全相同的下游依赖关系：
- **references** / **implementations**（Layer 2）：声明位置 → 查找使用点和实现
- **hover**（Layer 3）：声明位置 → 获取接口/抽象类文档
- **prepareRename** / **rename**（Layer 4）：声明位置 → 检查可重命名性、执行语义重命名

jdt:// URI 透传问题会阻塞全部下游命令链路。

## 5. 修复方案

### 5.1 Daemon 端 URI 重写

在 `handleDeclaration` 中增加与 `handleDefinition` 一致的 URI 重写：

```typescript
async function handleDeclaration(body, activeClient, startTime, res) {
  const posResult = await resolvePosition(body, activeClient);
  if ('success' in posResult) { sendResponse(res, {...}); return 'handled'; }
  const result = await activeClient.getDeclaration(body.file, posResult.line, posResult.col);
  // 增加 URI 重写（参考 handleDefinition:548-557）
  if (result) {
    if (result.uri && result.range) {
      return await rewriteLocation(result);
    } else if (Array.isArray(result)) {
      return await rewriteLocations(result);
    }
  }
  return result;
}
```

### 5.2 Compact 字段对齐

将 declaration 的 compact 字段与 definition 对齐，增加扩展字段：

```typescript
declaration: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
decl: [...] // 同上
```

### 5.3 涉及文件

- `src/daemon/routes/routeHandlers.ts:770-776` — 增加 URI 重写
- `src/core/types.ts:582-583` — compact 字段对齐 definition
- `src/cli/commands/declaration.ts` — 直接模式 URI 重写（与 definition 共用方案）

### 5.4 风险评估

daemon 端修改低风险（与 definition 完全一致的模式）。compact 字段对齐也是纯字段列表变更。
