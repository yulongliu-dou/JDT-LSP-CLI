# symbols 复查报告

## 1. 基本信息

- **CLI 命令**：`jls symbols <file>`（别名 `sym`），支持 `--flat` 扁平化输出
- **LSP 方法**：`textDocument/documentSymbol`
- **探路数据**：`test-output/explore/symbols.json`（1191 行，mybatis DefaultSqlSession.java 完整层次结构）
- **实现文件**：
  - CLI 层：`src/cli/commands/symbols.ts`
  - 连接层：`src/jdt/lspConnection.ts:252-260`
  - Kind 转换：`src/core/utils/symbolKind.ts`

## 2. 字段对照表

LSP DocumentSymbol 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `name` | `name` | ✓一致 | 直接透传。构造函数的 name 包含签名如 `DefaultSqlSession(Configuration, Executor, boolean)` |
| `kind` | `kind` | ✓一致 | 数字→字符串转换正确（1=File → "File"），`symbolKindToString()` 处理 |
| `detail?` | `detail` | ⚠偏差 | 完整模式透传，compact 模式缺失。detail 包含返回类型 `" : T"`、`" : List<T>"` 等，对 agent 判断方法用途有重要价值 |
| `range` | `range` | ✓一致 | 直接透传，compact 展开为 `range.start.line/character`, `range.end.line/character` |
| `selectionRange` | `selectionRange` | ⚠偏差 | 完整模式透传，compact 缺失。`range` 是整个声明范围（含注解、方法体），`selectionRange` 仅标识符位置。对有注解的类/方法，两者差距可达数行 |
| `children?` | `children` | ⚠偏差 | 完整模式透传，compact 必定缺失（嵌套数组无法通过字段白名单保留）。元数据标记 `childrenExcluded` |
| `tags?` | — | ✗缺失 | 完整模式透传但未验证 JDT LS 是否发送。compact 未包含。标记 deprecated(1) |

**Flat 模式额外字段**：

| Flat 构造字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `parent?` | `parent` | ⚠偏差 | flat 模式显式构造，完整输出有，compact 缺失。parent 是 flat 模式的核心价值——在扁平化后仍保留层次关系 |

## 3. JDT LS 行为偏差

无。

**已验证**：
- `detail` 返回值类型格式 `" : T"`、`" : List<T>"` — 符合规范
- 构造函数 name 包含参数类型签名 — JDT LS 标准行为
- `range` 为完整声明范围，`selectionRange` 为标识符范围 — 符合规范
- 包声明使用 kind=4（Package），类 kind=5（Class），字段 kind=8（Field），方法 kind=6（Method），构造器 kind=9（Constructor）— 均正确

**待验证**：`tags` 字段——mybatis 测试文件中无 `@Deprecated` 符号，无法确认 JDT LS 是否推送该字段。建议使用含 `@Deprecated` 注解的类验证。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺失 `detail` | P2 信息缺失 | Agent 无法看到方法返回类型（`" : T"` → 泛型方法，`" : List<User>"` → 返回集合）。agent 需要额外调用 hover/signatureHelp 才能获取，增加往返次数，违反原则 4（单次调用倾向）。 |
| compact 缺失 `selectionRange` | P2 信息缺失 | 有注解的类 `range.start` 指向注解行（如 `@Service`），`selectionRange.start` 才指向类名。agent 用 `range.start` 导航会定位到错误位置。例如：`DefaultSqlSession` 的 `range.start.line=40`（类声明行），`selectionRange.start.line=45`（类名行），差 5 行。 |
| compact 缺失 `tags` | P2 信息缺失 | Deprecated 标记丢失。Agent 无法快速识别废弃 API，可能在调用链中选择已废弃方法，并因此做出错误的代码建议。 |
| flat 模式 compact 缺失 `parent` | P2 功能降级 | Flat 模式的核心价值是"扁平化 → 线性扫描"，但 `parent` 是维持层次上下文的关键字段。缺失后 flat 模式退化为无序符号列表，违背设计意图。 |
| compact 缺失 `children` | P3 轻微 | 已知限制，有 `childrenExcluded` 元数据标记。用户在 compact 模式下期待精简输出，此举合理。但可以考虑在 compact 中添加 `childCount` 字段让 agent 知道子符号数量。 |

### 4.2 跨命令影响

symbols 输出的每个符号携带 `name` + `range`/`selectionRange`，可作为以下命令的位置输入：
- **definition**（Layer 2）：符号树中选中方法名 → 直接跳转定义
- **references**（Layer 2）：选中符号 → 查找所有引用
- **implementations**（Layer 2）：选中接口方法 → 查找实现
- **hover**（Layer 3）：选中符号 → 获取文档
- **rename**（Layer 4）：选中符号 → 发起重命名（`selectionRange` 提供精确的符号名范围）

核心链路 `symbols → def → refs/impl → ch` 的第一个环节。注意区分 `find`（`workspace/symbol` 全局搜索）——两者使用不同 LSP 方法，不存在数据流依赖。

## 5. 修复方案

### 5.1 扩展 compact 字段

`COMPACT_FIELDS.symbols` 和 `COMPACT_FIELDS.sym` 增加 `detail`、`selectionRange.start.line`、`selectionRange.start.character`、`parent`：

```typescript
symbols: ['name', 'kind', 'detail', 'range.start.line', 'range.start.character',
          'range.end.line', 'range.end.character',
          'selectionRange.start.line', 'selectionRange.start.character',
          'parent'],
```

`tags` 和 `children` 不在 compact 字段中加入（`tags` 需先验证 JDT LS 是否推送，`children` 是嵌套数组需特殊处理）。

### 5.2 涉及文件

- `src/core/types.ts:560-561` — `COMPACT_FIELDS.symbols` 和 `COMPACT_FIELDS.sym`

### 5.3 风险评估

低风险。仅修改 compact 字段白名单。
