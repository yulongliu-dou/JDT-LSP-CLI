# implementations 复查报告

## 1. 基本信息

- **CLI 命令**：`jls implementations [file]`（别名 `impl`），支持符号定位
- **LSP 方法**：`textDocument/implementation`
- **语义**：查找接口方法/抽象方法的所有具体实现
- **探路数据**：`test-output/explore/implementations.json`（空数组——selectOne 是 DefaultSqlSession 的具体方法，非接口方法，无下游实现，结果正确）
- **实现文件**：
  - CLI 层：`src/cli/commands/implementations.ts`
  - 客户端：`src/jdt/client.ts:204-211`
  - 连接层：`src/jdt/lspConnection.ts`（getImplementations）
  - 守护进程：`src/daemon/routes/routeHandlers.ts:621-635`（**含 URI 重写**）

## 2. 字段对照表

与 references 完全同构——均为 `Location[]` 返回。

| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| `uri` | `uri` | ✓一致 | 透传 |
| `range.start.line` | compact 有 | ✓ | |
| `range.start.character` | compact **缺** | **✗缺失** | **P1**：与 references 相同的遗漏，仅行号无列号 |
| `range.end.line/character` | compact 缺 | ✗缺失 | P2 |
| — | extension 字段 | ◐有条件 | daemon 有 URI 重写，直接模式无 |

## 3. JDT LS 行为偏差

无。探路数据空数组符合预期——在具体实现方法上调用 implementations 返回空（无下游实现类）。

## 4. 影响面评估

### 4.1 本命令影响

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| compact 缺 `range.start.character` | **P1 数据错误** | 与 references 完全相同的遗漏。implementations 是接口→实现的导航命令，返回的实现位置只有行号没有列号 |
| 直接模式缺 URI 重写 | P1 | 同 definition——对 JDK 接口的实现查找返回 jdt:// URI |

### 4.2 跨命令影响

implementations 输出格式 `{ uri, range }` 与 references/definition 一致，是接口到实现的导航枢纽。被后续命令消费：
- **definition**（Layer 2）：跳转到实现定义位置
- **references**（Layer 2）：查找实现方法的所有引用
- **hover**（Layer 3）：获取实现处的文档信息
- **rename**（Layer 4）：在实现处执行重命名

缺失列号影响所有下游命令的精确导航。

## 5. 修复方案

与 references 完全相同——compact 字段加 `range.start.character`：

```typescript
implementations: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
impl: ['uri', 'range.start.line', 'range.start.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
```

### 5.3 涉及文件

- `src/core/types.ts:564-565` — compact 字段

### 5.4 风险评估

低风险。与 references 完全相同的修复模式。
