# 内嵌 Help 系统规范

所有 CLI 命令的 `--help` 输出使用纯文本模板字符串，编译进 CLI 二进制。**新增命令、增删改选项时必须同步更新对应的 help 常量。**

## 文件组织

- **存放位置**: `src/cli/commands/help/`，一个命令模块对应一个 help 文件
- **命名规则**: `<命令名>Help.ts`（如 `cacheHelp.ts`、`daemonHelp.ts`、`callHierarchyHelp.ts`）
- **根命令 help**: `src/cli/commands/help/rootHelp.ts`，导出 `ROOT_HELP`
- **导出方式**: 每个 help 字符串使用 `export const` 命名导出，禁止 default export

## Help 内容结构

每个子命令 help 遵循统一格式（纯文本、无 ANSI 颜色）：

```
Usage: jls <command> [options]

<一行描述>

Options:
  --flag <arg>   描述
  -h, --help     显示帮助

Examples:
  jls <command> ...

On ambiguity:    ← 仅在命令存在歧义输出时添加
  ...
```

父命令 help（如 daemon）需额外包含 Subcommands 列表和 Typical usage。

## 命令文件中的引用方式

```typescript
import { FOO_HELP } from './help/fooHelp';

// 在子命令上设置
subCmd.configureHelp({ formatHelp: () => FOO_HELP });
```

## 父命令 help 的两种模式

| 场景 | 模式 | 示例 |
|------|------|------|
| 子命令含义非自明、需要选择指引 | **手写父级 help** | daemon（子命令多、有推荐用法） |
| 子命令语义自明、commander 自动列表即可 | **重置为 commander 默认** | config、jre、jdt、cache |

**手写父级 help 时**，对父命令显式设置 `configureHelp`：

```typescript
daemonCmd.configureHelp({ formatHelp: () => DAEMON_HELP });
```

**重置为 commander 默认时**，在文件顶部定义 `defaultFormatHelp` 并应用到父命令：

```typescript
import { Command, Help } from 'commander';
const defaultFormatHelp = (cmd: Command, helper: Help) => new Help().formatHelp(cmd, helper);

const parentCmd = program.command('xxx').configureHelp({ formatHelp: defaultFormatHelp });
```

## 维护要求

- **新增子命令** → 在对应 help 文件中新增一个 `export const`，在命令文件中 import 并 `configureHelp`
- **修改选项/参数** → 同步修改 help 字符串中的 Options 和 Examples 段
- **新增命令模块** → 新建 `<name>Help.ts`，按上述格式写 help 内容
- **不改动功能时** → help 是纯文本，无需测试，视觉检查即可
