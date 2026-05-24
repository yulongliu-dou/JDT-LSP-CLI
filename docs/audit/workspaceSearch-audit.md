# workspaceSearch (find) 复查报告

## 1. 基本信息

- **CLI 命令**：`jls find <query>`（别名 `f`），支持 `--kind` / `--limit` 过滤
- **LSP 方法**：`workspace/symbol`
- **LSP 返回类型**：`SymbolInformation[]`，每个包含 `{ name, kind, location: {uri, range}, containerName?, tags? }`
- **语义**：全局符号搜索，不限定文件范围
- **探路数据**：`test-output/explore/workspaceSymbols.json`（搜索 "SqlSession"，返回多个类/接口，含 jdt:// URI 的 jar 依赖项）
- **实现文件**：
  - CLI 层：`src/cli/commands/workspaceSearch.ts`
  - 客户端：`src/jdt/client.ts:238-240`
  - 连接层：`src/jdt/lspConnection.ts:319-331`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:927-952`

## 2. 字段对照表

LSP SymbolInformation 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `name` | `name` | ✓一致 | |
| `kind` | `kind` | ✓一致 | 数字→字符串转换正确 |
| `location.uri` | `location.uri` | ⚠偏差 | **无 URI 重写**——jdt:// URI 原样返回（探路数据可证：Derby 的 SQLSessionContextImpl 返回 jdt:// 长 URI） |
| `location.range.start.line` | compact 有 | ✓ | |
| `location.range.start.character` | compact **缺** | **✗缺失** | **P1**：与 references 家族相同的遗漏 |
| `location.range.end.line/character` | compact 缺 | ✗缺失 | P2 |
| `containerName?` | — | **✗缺失** | P2：包/容器名在 compact 中丢失。对同名符号消歧至关重要 |
| `tags?` | — | ✗缺失 | P3：deprecated 标记丢失 |

### 2.1 数据结构差异

`workspace/symbol` 返回 `SymbolInformation[]`（每个有嵌套 `location: { uri, range }`），与 `textDocument/definition` 的扁平 `Location[]`（`{ uri, range }`）不同。现有的 `rewriteLocations()` 不能直接用于此结构——需对每个 `s.location` 做 `rewriteLocation()`。

## 3. JDT LS 行为偏差

无。

- 搜索结果含项目内符号（file:// URI）和依赖项符号（jdt:// URI），符合 JDT LS 标准行为 ✓
- `kind` 数值遵循 SymbolKind 枚举，映射正确 ✓
- `containerName` 正确返回包名 ✓

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| **无 URI 重写（daemon + direct 双模式）** | **P1 数据错误** | 探路数据明确显示 jdt:// URI 存在（Derby 依赖项）。Agent 收到 `jdt://contents/derby-10.17.1.0.jar/org.apache.derby.impl.sql.conn/SQLSessionContextImpl.java?...` 无法使用。find 是 agent 探索项目的首要命令——拿到的结果却无法继续操作，违反原则 1（探索式推进） |
| compact 缺 `location.range.start.character` | P1 | 与 references 家族同模式 |
| compact 缺 `containerName` | **P2** | `find "DefaultSqlSession"` 可能返回多个结果，`containerName` 是唯一区分配套路径的字段。缺少此字段 agent 无法区分同名符号来源，违反原则 2（失败可自愈——歧义场景必须列出候选项和消歧参数） |
| compact 缺 `range.end` | P2 | 同上 |

### 4.2 跨命令影响

`find` 是 agent 探索入口命令。输出被用于：
- 获取候选文件路径 → 调用 symbols 分析文件结构
- 获取符号位置 → 调用 definition/references/hover

jdt:// URI 透传和 containerName 缺失会阻断从 find 到后续命令的链路。

## 5. 修复方案

### 5.1 Daemon 端 URI 重写

在 `handleWorkspaceSymbols` 中对每个 symbol 的 `location` 执行 `rewriteLocation`：

```typescript
for (const s of outputSymbols) {
  if (s.location) {
    s.location = await rewriteLocation(s.location);
  }
}
```

### 5.2 扩展 compact 字段

```typescript
workspaceSymbols: ['name', 'kind', 'containerName', 'location.uri', 'location.range.start.line', 'location.range.start.character'],
find: ['name', 'kind', 'containerName', 'location.uri', 'location.range.start.line', 'location.range.start.character'],
f: ['name', 'kind', 'containerName', 'location.uri', 'location.range.start.line', 'location.range.start.character'],
```

### 5.3 涉及文件

- `src/daemon/routes/routeHandlers.ts:927-952` — 增加 URI 重写
- `src/core/types.ts:568-570` — compact 字段扩展
- `src/cli/commands/workspaceSearch.ts` — 直接模式 URI 重写

### 5.4 风险评估

中等风险。`rewriteLocation` 接受 `Location` 对象，workspaceSymbol 的 `location` 字段就是 `Location` 类型，接口兼容。需注意批量重写的性能——find 可能返回大量结果。
