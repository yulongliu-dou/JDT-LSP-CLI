# 19 个 LSP 命令复查设计

对已有 19 个 CLI 命令实现进行系统性复查，对比 JDT LS 原始返回数据，检查字段遗漏、含义偏差、JDT LS 行为异常，评估影响面并逐个修复。

## 复查分层与顺序

```
第 1 层：代码结构感知（底层）
  diagnostics → symbols → semanticTokens

第 2 层：符号定位与导航
  definition → declaration → references → implementations → typeDefinition → workspaceSearch

第 3 层：符号详情信息
  hover → signatureHelp → documentHighlight

第 4 层：代码操作与增强
  codeAction → codeLens → completion → formatting → inlayHint → prepareRename → rename
```

每一层是上一层的依赖，先审底层、后审上层。发现问题需列出跨命令影响面。

## 复查深度

- **B 级**：对比 LSP 原始返回全部字段 vs CLI 输出，记录缺失/偏差；检查 JDT LS 实际行为是否偏离 LSP 规范
- **C 级**：评估每个差异的影响面——本命令影响 + 跨命令影响，给出严重程度分级

## 复查报告模板

每命令一份独立 markdown 报告，存放于 `docs/audit/`。

```markdown
# {命令名} 复查报告

## 1. 基本信息
- CLI 命令：jls {command}
- LSP 方法：textDocument/{method}
- 探路数据：test-output/explore/{name}.json
- 实现文件：src/cli/commands/{name}.ts

## 2. 字段对照表
| LSP 原始字段 | CLI 输出字段 | 状态 | 备注 |
|-------------|-------------|------|------|
| xxx         | yyy         | ✓一致/✗缺失/⚠偏差 | 说明 |

## 3. JDT LS 行为偏差
（与 LSP 规范的差异）

## 4. 影响面评估
### 4.1 本命令影响
- 严重程度：P0阻断/P1数据错误/P2信息缺失/P3无影响
- 具体场景描述

### 4.2 跨命令影响
（如有，列出受影响的命令及具体字段）

## 5. 修复方案
- 方案描述
- 涉及文件
- 风险评估
```

## 执行流程

1. 读取目标命令的 CLI 实现源码
2. 读取对应的探路 JSON 数据
3. 对照 LSP 规范定义，逐字段比对
4. 生成复查报告，写入 `docs/audit/<command>-audit.md`
5. 用户审阅报告，确认修复方案
6. 实施修复代码
7. 运行探路脚本验证修复后的输出
8. 进行下一命令

## 跨命令影响追踪

在复查过程中发现影响其他命令的问题时：
1. 在当前报告中"4.2 跨命令影响"章节列出
2. 在受影响命令的复查报告中引用上游报告

## 待办

callHierarchy（prepareCallHierarchy + incomingCalls + outgoingCalls）待 19 个命令复查完成后接入。
