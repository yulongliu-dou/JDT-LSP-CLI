# definition 复查报告

## 1. 基本信息

- **CLI 命令**：`jls definition [file]`（别名 `def`），支持 `--symbol`/`--method`/`--global` 符号定位
- **LSP 方法**：`textDocument/definition`
- **LSP 返回类型**：`Location | Location[] | LocationLink[] | null`
- **探路数据**：`test-output/explore/definition.json`（在 selectOne 方法调用处跳转，正确返回定义位置行 66 列 15-24）
- **实现文件**：
  - CLI 层：`src/cli/commands/definition.ts`
  - 客户端：`src/jdt/client.ts:156-163`
  - 连接层：`src/jdt/lspConnection.ts:223-232`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:537-558`（含 URI 重写）
  - URI 重写：`src/libraryProvider/uriRewriter.ts:70-95`

## 2. 字段对照表

LSP Location 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `uri` | `uri` | ✓一致 | 文件符号返回 `file://` URI；JDK 符号经 daemon 重写后为本地路径 URI |
| `range` | `range` | ✓一致 | 直接透传，compact 展开为 `range.start.line` / `range.start.character` |
| — | `originalUri` | ✓补充 | daemon 模式下 jdt:// URI 的重写前原始值（SP02），compact 包含 |
| — | `originalRange` | ✓补充 | 重写前原始 range，compact 包含 |
| — | `source` | ✓补充 | 源码来源：`jdk-src`, `sources-jar`, `decompiled`, `class-file-contents`，compact 包含 |
| — | `note` | ✓补充 | 补充说明，compact 包含 |
| — | `lockWaitMs` | ✓补充 | 锁等待耗时，compact 包含 |
| — | `lineMapping` | ✓补充 | 行映射精度：`exact`, `best-effort`, `n/a`，compact 包含 |

### 2.1 LocationLink 格式处理

LSP 规范中 `LocationLink` 的字段：

| LSP LocationLink 字段 | CLI 输出 | 状态 | 备注 |
|----------------------|---------|------|------|
| `originSelectionRange` | 透传 | ⚠未处理 | JDT LS 不使用 LocationLink，当前无实际影响 |
| `targetUri` | 透传 | ⚠热路径 | 若服务器返回 LocationLink，URI 重写会失效（检查 `loc.uri` 而非 `loc.targetUri`） |
| `targetRange` | 透传 | ⚠同上 | |
| `targetSelectionRange` | 透传 | ⚠同上 | |

**结论**：JDT LS 1.58.0 对 Java 文件始终返回 `Location[]`，不使用 `LocationLink`。上述 LocationLink 问题为理论风险，暂不构成实际影响。

## 3. JDT LS 行为偏差

无。

- 定义位置精确指向标识符：`selectOne` 调用处（行 67）跳转到定义处（行 66, col 15-24），仅覆盖方法名（9 字符），不展开完整声明 ✓
- 返回格式为 `Location[]`，非 `LocationLink[]` ✓
- URI 格式为 `file:///E:/...`，Windows 路径处理正确 ✓

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| 直接模式缺少 URI 重写 | **P1 数据错误** | 直接模式（`--no-daemon` 或 daemon 未启动时自动回退）返回原始 jdt:// URI，而非可读的本地文件路径。Agent 拿到 `jdt://contents/java.base/java/util/List.class?...` 无法用作下一步输入。**注**：仅影响 JDK/第三方库符号的定义跳转，项目内符号使用 file:// URI 不受影响。 |
| compact 缺少 `range.end` | P3 轻微 | `range.end.line` / `range.end.character` 不在 compact 列表中。对于标识符级别的 range（通常单行 9 字符），end 信息价值有限。但符号定义（如 annotations 修饰的类声明）range 可能跨多行，缺少 end 会丢失定义范围感知。 |

### 4.2 跨命令影响

**高频依赖**。definition 的输出 `{ uri, range }` 是后续命令的核心输入：
- **references**：直接消费 `uri` + `range.start` 构造 position
- **implementations**：同上
- **hover**：同上
- **typeDefinition**：同上
- **prepareRename**（Layer 4）：使用 definition 返回的位置检查目标符号是否可重命名
- **rename**（Layer 4）：使用 definition 返回的位置在符号定义处执行语义重命名

当前输出格式（`Location[]`）与上述命令输入格式完全匹配，格式一致性良好。**但**直接模式下 jdt:// URI 未被重写的问题也会传播到后续命令——agent 拿 jdt:// URI 去调 references 会得到空结果。

## 5. 修复方案

### 5.1 直接模式 URI 重写

在直接模式执行路径中增加 URI 重写步骤。`definition.ts` 的 `directHandler` 获取结果后，对 jdt:// URI 执行与 daemon 相同的 `rewriteLocations` 处理：

```typescript
// definition.ts, executeCommand 的 directHandler 中
const result = await client.getDefinition(filePath, finalLine, finalCol);
if (Array.isArray(result)) {
  const { rewriteLocations } = await import('../../libraryProvider/uriRewriter');
  return await rewriteLocations(result);
}
```

### 5.2 涉及文件

- `src/cli/commands/definition.ts` — 直接模式添加 URI 重写
- 同模式问题还存在于 `references.ts`, `implementations.ts`, `typeDefinition.ts`, `declaration.ts` 等第 2 层其他命令，需同步修复

### 5.3 风险评估

中等风险。在 CLI 命令层引入 URI 重写需要确保 `LibraryClassLocator` 在非 daemon 环境下正确初始化。建议抽取共享的直接模式重写工具函数，避免各命令重复实现。
