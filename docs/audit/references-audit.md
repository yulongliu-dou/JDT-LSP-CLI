# references 复查报告

## 1. 基本信息

- **CLI 命令**：`jls references [file]`（别名 `refs`），支持 `--no-declaration` 排除声明自身
- **LSP 方法**：`textDocument/references`
- **LSP 返回类型**：`Location[] | null`
- **探路数据**：`test-output/explore/references.json`（selectOne 方法在 mybatis 项目中的 7 处引用，含测试文件）
- **实现文件**：
  - CLI 层：`src/cli/commands/references.ts`
  - 客户端：`src/jdt/client.ts:168-175`
  - 连接层：`src/jdt/lspConnection.ts:237-247`
  - 守护进程：`src/daemon/routes/routeHandlers.ts:563-578`（**含 URI 重写**）

## 2. 字段对照表

LSP Location 规范字段 vs CLI 输出：

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `uri` | `uri` | ✓一致 | 透传 |
| `range` | `range` | ✓一致 | 透传，compact 展开为 `range.start.line`（⚠行号有、列号无） |
| `range.start.line` | compact 有 | ✓ | |
| `range.start.character` | compact **缺** | **✗缺失** | **P1**：只有行号没有列号，agent 无法精确定位光标 |
| `range.end.line` | compact 缺 | ✗缺失 | P2：引用 range 宽度差异大（20-80+ 字符），缺少 end 丢失引用表达式上下文 |
| `range.end.character` | compact 缺 | ✗缺失 | 同上 |
| — | `originalUri` | ◐有条件 | daemon 含 jdt:// 时有；compact 声明但直接模式无用 |
| — | `source` | ◐有条件 | 同上 |
| — | `note` | ◐有条件 | 同上 |
| — | `lockWaitMs` | ◐有条件 | 同上 |
| — | `lineMapping` | ◐有条件 | 同上 |

### 2.1 compact 字段对比（references vs definition）

| 字段 | definition | references | 差异 |
|------|-----------|------------|------|
| `uri` | ✓ | ✓ | 一致 |
| `range.start.line` | ✓ | ✓ | 一致 |
| `range.start.character` | ✓ | **缺** | **不一致，bug** |
| `originalUri` | ✓ | ✓ | 一致 |
| `originalRange` | ✓ | ✓ | 一致 |
| `source` | ✓ | ✓ | 一致 |
| `note` | ✓ | ✓ | 一致 |
| `lockWaitMs` | ✓ | ✓ | 一致 |
| `lineMapping` | ✓ | ✓ | 一致 |

## 3. JDT LS 行为偏差

无。

- 引用返回包含声明自身（includeDeclaration: true）✓
- Range 宽度在 20-80+ 字符范围，JDT LS 根据上下文返回标识符级或表达式级范围，符合标准行为 ✓
- 跨文件引用（SqlSessionManager.java, SqlSessionTest.java, IncludeTest.java 等）正确返回 ✓

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 场景描述 |
|------|---------|---------|
| compact 缺 `range.start.character` | **P1 数据错误** | Agent 拿到 `{uri, line: 158}` 但缺少列号，无法跳到精确引用位置。references 是 agent 高频命令（"谁在用这个方法？"），精度损失直接破坏后续导航链路。对比 definition 的 compact 正确包含此字段，纯属遗漏。 |
| 直接模式缺 URI 重写 | P1 | 同 definition，对 JDK 方法的引用返回 jdt:// URI |
| compact 缺 `range.end` | P2 | 探路数据显示引用 range 宽度从 20 到 80+ 字符不等。缺少 end 位置，agent 无法区分"简单方法调用"和"复杂表达式中的引用" |

### 4.2 跨命令影响

references 是 agent 核心链路 `def → refs → impl → ch` 的关键环节。输出 `{ uri, range }` 被后续命令直接消费：
- **hover**（Layer 3）：消费 reference 位置，获取引用处的文档
- **definition**（Layer 2）：消费 reference 位置，反向确认定义
- **rename**（Layer 4）：每个引用位置的 (uri + range) 都是 rename 的目标——agent 可验证重命名覆盖全部引用点

- 缺失 `range.start.character` → agent 无法用引用位置做 hover/definition/rename 的精确输入
- 对 JDK 方法引用返回 jdt:// URI → 后续命令无法操作该引用

## 5. 修复方案

### 5.1 修复 compact 字段

```typescript
// 对齐 definition，添加 range.start.character
references: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
refs: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
```

### 5.2 直接模式 URI 重写

与 definition 共用解决方案——在 CLI 层对返回结果执行 `rewriteLocations`。

### 5.3 涉及文件

- `src/core/types.ts:558-559` — compact 字段加 `range.start.character`
- `src/cli/commands/references.ts` — 直接模式 URI 重写（与其他第 2 层命令一起统一处理）

### 5.4 风险评估

低风险。compact 字段修改仅一行添加。URI 重写方案与其他命令共用。
