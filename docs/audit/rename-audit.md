# rename 复查报告

## 1. 基本信息

- **CLI 命令**：`jls rename <file> --new-name <name>`，必填 `--new-name`，支持符号定位
- **LSP 方法**：`textDocument/rename`
- **LSP 返回类型**：`WorkspaceEdit | null`，含 `changes: { [uri]: TextEdit[] }` 和/或 `documentChanges`
- **语义**：语义级重命名——返回所有需要修改的位置（跨文件），不遗漏不误改
- **探路数据**：`test-output/explore/rename.json`（selectOne → renamedMethod，5 个文件 5 处修改——声明 + SqlSession 接口 + 3 处调用点）
- **实现文件**：
  - CLI 层：`src/cli/commands/rename.ts`（含 `flattenWorkspaceEdit`）
  - 客户端：`src/jdt/client.ts:301-309`
  - 连接层：`src/jdt/lspConnection.ts:463-473`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:668-700`（含相同扁平化）

## 2. 字段对照表

### 2.1 WorkspaceEdit 扁平化

原始 LSP `WorkspaceEdit: { changes: { [uri]: TextEdit[] } }` → 扁平化为：
```
{ changes: [{ file: "file:///...", edits: [{range, newText}, ...] }, ...], count: N }
```

| 转换 | 状态 | 备注 |
|------|------|------|
| `changes[uri]` → `file` | ✓ | 键值对 → 数组对象，agent 友好 |
| `documentChanges` 处理 | ✓ | 也支持 TextDocumentEdit 格式 |
| URI 重写 | — | rename 的 URI 均为项目内 file://，无 jdt:// 场景 |

### 2.2 compact 字段分析

compact 字段：`['file', 'range.start.line', 'range.start.character', 'newText']`（TODO 注释："edits 为嵌套数组，compact 暂按 change 级别处理"）

扁平化后的数据结构：
```json
{
  "changes": [
    {
      "file": "file:///E:/.../DefaultSqlSession.java",
      "edits": [
        { "range": { "start": {...}, "end": {...} }, "newText": "renamedMethod" },
        ...  // 可能多个 edits
      ]
    }
  ]
}
```

compact 应用于每个 `changes[]` 项时：

| compact 字段 | 查找路径 | 实际位置 | 匹配 | 结果 |
|-------------|---------|---------|------|------|
| `file` | `item.file` | `item.file` | ✓ | 有值 |
| `range.start.line` | `item.range.start.line` | `item.edits[0].range.start.line` | **✗不匹配** | undefined |
| `range.start.character` | `item.range.start.character` | `item.edits[0].range.start.character` | **✗不匹配** | undefined |
| `newText` | `item.newText` | `item.edits[0].newText` | **✗不匹配** | undefined |

**结论：compact 仅保留 `file`，所有编辑信息丢失。**

## 3. JDT LS 行为偏差

无。

- WorkspaceEdit 跨文件正确（5 个文件 5 处修改） ✓
- `changes` 格式正确（非 `documentChanges`），扁平化处理正常 ✓

**注意**：JDT LS 的 rename `newText` 在某些情况下包含大段还原内容（如 IncludeTest.java 的 edit 从调用点覆盖到方法结束并重新插入重命名后的内容）。这是 JDT LS 的标准行为，非本项目问题。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 路径错误（嵌套 edits 问题） | **P1 数据错误** | compact 模式只返回 `{ file: "file:///..." }`——agent 知道改了哪些文件但不知道改了什么、改在哪里。commands 的核心价值（所有 rename 位置）在 compact 中完全丢失 |
| 扁平化正确 | ✓ | 全量模式输出结构清晰，agent 友好 |
| WorkspaceEdit 双格式兼容 | ✓ | changes + documentChanges 都正确处理 |

### 4.2 跨命令影响

rename 是终端操作命令——输出为编辑列表，不被其他命令消费。无跨命令影响。

## 5. 修复方案

### 5.1 嵌套 compact 处理

rename 的 `edits` 是嵌套数组，超出了简单 dot-path 的 compactItem 能力范围。两种方案：

**方案 A（推荐）**：在 CLI/daemon 层对 rename 做专用 compact 处理——将 edits 中的每个 edit 提升一个层级展开：

```
[{ file, edit: { range, newText } }, ...]  // 每个 edit 独立条目
```

**方案 B**：保留当前结构，放宽 compactItem 支持数组索引路径（如 `edits[0].range.start.line`）。但不适用于多 edit 场景。

### 5.2 修复 compact 字段

配合方案 A：
```typescript
rename: ['file', 'edit.range.start.line', 'edit.range.start.character', 'edit.newText'],
```

### 5.3 涉及文件

- `src/cli/commands/rename.ts:86-117` — 扁平化时展开 edits
- `src/daemon/routes/routeHandlers.ts:682-700` — 同上
- `src/core/types.ts:573-574` — compact 字段配合调整

### 5.4 风险评估

中等风险。修改扁平化逻辑会影响完整模式输出格式（增加条目数），需确保不破坏现有 agent 的使用方式。建议同时保留 `edits` 数组作为参考。
