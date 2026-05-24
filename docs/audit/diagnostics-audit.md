# diagnostics 复查报告

## 1. 基本信息

- **CLI 命令**：`jls diagnostics <file>`（别名 `diag`）
- **LSP 方法**：`textDocument/publishDiagnostics`（通知，非请求）
- **探路数据**：`test-output/explore/diagnostics.json`（mybatis 项目无诊断错误，rawResponse 为空数组）
- **实现文件**：
  - CLI 层：`src/cli/commands/diagnostics.ts`
  - 连接层：`src/jdt/lspConnection.ts:404-443`
  - 客户端：`src/jdt/client.ts:282-284`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:655-663`

## 2. 字段对照表

LSP Diagnostic 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `range` | `range` | ✓一致 | 直接透传，compact 下展开为 `range.start.line` / `range.start.character` |
| `severity?` | `severity` | ✓一致 | 直接透传，LSP 数值（1=Error, 2=Warning, 3=Information, 4=Hint），compact 保留 |
| `message` | `message` | ✓一致 | 直接透传 |
| `code?` | `code` | ✓一致 | 直接透传 |
| `codeDescription?` | — | ✗缺失 | 链接到规则文档的 href URI，compact 未包含 |
| `source?` | — | ✗缺失 | 标识诊断来源（如 "Java"），可区分编译器错误 vs linter 警告 |
| `tags?` | — | ✗缺失 | DiagnosticTag[]，标记 deprecated(2) / unnecessary(1)，compact 未包含 |
| `relatedInformation?` | — | ✗缺失 | 关联位置列表，compact 未包含 |
| `data?` | — | ✗缺失 | JDT LS 扩展数据，compact 未包含 |

**说明**：非 compact（完整输出）模式下所有字段透传，以上缺失仅在 compact 模式下出现。

## 3. JDT LS 行为偏差

无。`textDocument/publishDiagnostics` 是通知类型，JDT LS 按规范在文档打开后推送。当前实现通过 `DidOpenTextDocument` 触发、轮询等待推送、`DidCloseTextDocument` 清理，是标准且正确的处理方式。

**注意**：探路数据 rawResponse 为空数组，因为 mybatis-3-master 无诊断错误。建议有诊断错误的项目上验证实际输出，以确保 JDT LS 推送的字段完整性。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺失 `source` | P2 信息缺失 | Agent 无法区分诊断来源（编译器 vs linter vs 其他插件），在有多源诊断时无法按来源过滤。例如 agent 想知道"只看 Java 编译错误，忽略 Checkstyle 警告"。 |
| compact 缺失 `tags` | P2 信息缺失 | Agent 无法识别 `deprecated` 或 `unnecessary` 标记。例如 `unnecessary` 标记的未使用变量，agent 可以安全删除。缺少此信息需要 agent 自行推断。 |
| compact 缺失 `relatedInformation` | P2 信息缺失 | 关联位置丢失。例如 "未实现接口方法" 的诊断，relatedInformation 指向接口定义位置。缺少此信息破坏了原则 3（组合输出携带下一步参数）——agent 无法直接跳转到关联位置。 |
| compact 缺失 `codeDescription` | P3 轻微 | 规则文档链接缺失，agent 可通过其他方式获取文档。影响较小。 |

**结论**：核心诊断信息（severity、message、range、code）完整，无 P0/P1 问题。三处 P2 缺失影响 agent 的过滤、判断和导航能力。

### 4.2 跨命令影响

diagnostics 输出的 `range` + `message` + `code` + `severity` 可作为 **codeAction**（Layer 4）的 `context.diagnostics` 输入：
- **codeAction**：传入当前行诊断信息，使 codeAction 能返回基于诊断的快速修复（如缺失 import 补全、try-catch 包围）。当前 CLI 的 codeAction 硬编码传空数组 `[]`，仅返回无上下文的通用操作——补充此链路可解锁诊断驱动的智能修复场景。

## 5. 修复方案

### 5.1 扩展 compact 字段

在 `src/core/types.ts` 的 `COMPACT_FIELDS.diagnostics` 和 `COMPACT_FIELDS.diag` 中增加 `source`、`tags`：

```
diagnostics: ['severity', 'message', 'code', 'range.start.line', 'range.start.character', 'source', 'tags'],
```

`relatedInformation` 体积较大（嵌套数组），不建议加入 compact。完整模式下已透传。

### 5.2 涉及文件

- `src/core/types.ts:571-572` — `COMPACT_FIELDS.diagnostics` 和 `COMPACT_FIELDS.diag`

### 5.3 风险评估

低风险。仅修改 compact 字段白名单，不改变任何逻辑或数据流。
