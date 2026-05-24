# 内嵌 Help 系统设计

**日期：** 2026-05-24
**状态：** 已批准

## 问题

`docs/commands/` 下存放了各命令的详细使用文档（Markdown 格式），但这些文件不会随 npm 包分发。通过 npm 安装 `jdt-lsp-cli` 的用户无法获取命令使用说明。当前 `--help` 输出依赖 commander 自动生成的选项列表，缺乏使用示例、典型工作流和面向 Agent 的操作指导。

## 目标

将命令使用文档直接内嵌到 CLI 的 help 输出中：
- `jls --help` 显示完整使用说明，包含工作流和 Agent 提示
- `jls <command> --help` 显示命令专属的选项、示例和错误恢复提示
- 所有 help 内容随 npm 包分发，不依赖外部文档
- 纯文本输出（无 ANSI 彩色），面向 AI Agent 消费者优化

## 设计

### 输出格式规则

- 所有 help 输出为**纯文本**（不使用 chalk、boxen 或 ANSI 转义码）
- Help 输出直接到 **stdout** — 不经过 `outputResult()`（不包装为 JSON）
- `jls -h` 和 `jls --help` 等价；子命令同理

### 实现模式

每个命令文件采用统一模式：help 字符串定义为文件顶部的模块级常量，以分隔注释标注。使用 commander 的 `.configureHelp()` 完全接管 help 输出：

```ts
// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls definition <file> [options]
       jls def <file> [options]

跳转到符号的定义位置。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器，如 "MyClass.myMethod"
  --signature <sig>     消歧义重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  --line <n>            行号（1-based，替代 --method）
  --col <n>             列号（1-based）
  -h, --help            显示帮助

Examples:
  jls def Service.java --method processOrder
  jls def Service.java --method process --signature "(String, int)"
  jls def Service.java --method process --index 1
  jls def --global --symbol ArrayList --kind Class

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerDefinitionCommand(program: Command) {
  const cmd = program
    .command('definition [file]')
    .alias('def')
    .description('跳转到符号的定义位置。')
    .configureHelp({ formatHelp: () => HELP });

  // ... 其余 options 和 action 不变
}
```

### 根 help 结构 (`jls --help`)

写在 `src/cli/index.ts`，作为 `ROOT_HELP` 常量。

```
Usage: jls <command> [options]

基于 Eclipse JDT Language Server 的 Java 代码分析 CLI 工具。

Commands:
  find, f            全局搜索类、方法、字段
  symbols, sym       列出文件中的符号
  definition, def    跳转到符号定义
  references, refs   查找所有引用
  hover              获取 Javadoc 和类型信息
  call-hierarchy, ch 分析调用链
  implementations, impl 查找实现
  type-definition, typedef 跳转到类型定义
  daemon             管理后台守护进程
  cache              管理源码缓存和 Jar 解析
  config             查看/编辑配置
  jre                管理内嵌 JRE
  jdt                管理内嵌 JDT LS

Global Options:
  -p, --project <path>   项目根路径（LSP 命令必需）
  --json-compact         紧凑 JSON（减少 token 消耗）
  --timeout <ms>         命令超时（默认：30000）
  -v, --verbose          详细输出
  -h, --help             显示帮助

Typical workflows:
  # 探索一个未知类
  jls find UserService --kind Class
  jls sym src/.../UserService.java --flat
  jls ch src/.../UserService.java --method processOrder -d 2

  # 追踪一个方法
  jls def Service.java --method process
  jls refs Service.java --method process
  jls impl Service.java --method process

Agent notes:
  - 先启动 daemon 以大幅提升速度：jls daemon start --eager --init-project <path>
  - 使用 --json-compact 减少 token 消耗
  - 符号歧义时使用 --index 0/1/2 重试
  - 运行 jls <command> --help 查看命令专属用法
```

### 子命令 help 结构 (`jls <command> --help`)

```
Usage: jls <command> <params> [options]

<一行功能描述>

Options:
  --flag, -f <type>   描述 (default: xxx)

Examples:
  jls cmd file --flag value

On ambiguity:
  <消歧提示>
```

### 父命令 help（带子命令的命令）

**原则：只在子命令选择需要上下文说明时才手写父 help。** 如果父命令的子命令语义一目了然（如 `jre` 的 status/download/remove），保留 commander 自动生成的输出。

**需要手写的判断标准：** 子命令之间存在选择逻辑——例如 `daemon`（health vs status，start --wait vs start --eager 各有适用场景）。父 help 应说明_什么情况下该用哪个子命令_，而非仅列出子命令名称。

结构：
```
Usage: jls <parent> <subcommand> [options]

<描述，重点：子命令对比说明>

Subcommands:
  <name>   <描述，包含关键 flag 提示>

Typical usage:
  # 场景1
  jls <parent> <sub> --flag

  # 场景2
  jls <parent> <sub> --flag

Agent notes:
  - 操作建议

Run 'jls <parent> <subcommand> --help' 查看子命令专属选项。
```

各子命令也各自内联自己的 HELP，用于 `jls <parent> <sub> --help`。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `src/cli/index.ts` | 新增 `ROOT_HELP` 常量 + `program.configureHelp()` |
| `src/cli/commands/definition.ts` | 新增 `HELP` 常量 + `.configureHelp()` |
| `src/cli/commands/references.ts` | 同上 |
| `src/cli/commands/hover.ts` | 同上 |
| `src/cli/commands/implementations.ts` | 同上 |
| `src/cli/commands/typeDefinition.ts` | 同上 |
| `src/cli/commands/workspaceSearch.ts` | 同上（find 命令） |
| `src/cli/commands/symbols.ts` | 同上 |
| `src/cli/commands/commandHandlers.ts` | 同上（call-hierarchy 命令） |
| `src/cli/commands/daemon.ts` | `DAEMON_HELP` + start/stop/status 等子命令的 HELP |
| `src/cli/commands/config.ts` | init/show/path/defaults 子命令的 HELP |
| `src/cli/commands/jre.ts` | status/download/remove 子命令的 HELP |
| `src/cli/commands/jdt.ts` | status/update/remove 子命令的 HELP |
| `src/cli/commands/cache.ts` | stats/clean/warm 子命令的 HELP |

### 明确不做

- 不新建目录或文件
- 不引入新依赖（chalk、boxen 等）
- 不为 help 输出编写自动化测试（人工视觉检查）
- 不提取共享 Agent notes 片段（各命令独立维护）
- 保留现有 `docs/commands/` 文件不变——它们仍是文档内容的事实来源
