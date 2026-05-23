# Inline Help System Design

**Date:** 2026-05-24
**Status:** approved

## Problem

`docs/commands/` contains detailed command documentation in Markdown files. These files are not distributed with the npm package, so users installing `jdt-lsp-cli` from npm have no built-in access to command usage documentation. The current `--help` output relies on commander's auto-generation from option definitions, which lacks usage examples, typical workflows, and agent-oriented guidance.

## Goal

Embed command documentation directly into CLI help output so that:
- `jls --help` shows comprehensive usage including workflows and agent notes
- `jls <command> --help` shows command-specific options, examples, and error recovery hints
- All help content ships with the npm package — no external doc dependency
- Output is plain text (no ANSI colors) — optimized for AI Agent consumers

## Design

### Output format rules

- All help output is **plain text** (no chalk, boxen, or ANSI escape codes)
- Help output goes directly to **stdout** — it does NOT pass through `outputResult()` (no JSON wrapping)
- `jls -h` and `jls --help` are equivalent; same for subcommands

### Implementation pattern

Each command file uses a consistent pattern. The help string is defined as a module-level constant at the top of the file, separated by a divider comment. `commander`'s `.configureHelp()` fully replaces auto-generated help:

```ts
// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls definition <file> [options]
       jls def <file> [options]

Jump to the definition of a symbol at a given position or by name.

Options:
  --method <name>       Method name (auto-resolves position)
  --symbol <name>       Symbol name (auto-resolves position)
  --container <path>    Parent container, e.g. "MyClass.myMethod"
  --signature <sig>     Disambiguate overloads, e.g. "(String, int)"
  --index <n>           Select from multiple matches (0-based)
  --kind <type>         Method | Field | Class | Interface
  --global              Global search (requires --symbol AND --kind)
  --line <n>            Line number (1-based, alternative to --method)
  --col <n>             Column number (1-based)
  -h, --help            Show this help

Examples:
  jls def Service.java --method processOrder
  jls def Service.java --method process --signature "(String, int)"
  jls def Service.java --method process --index 1
  jls def --global --symbol ArrayList --kind Class

On ambiguity:
  If multiple symbols match, retry with --index 0/1/2 to select.
  Use --signature to distinguish overloaded methods.
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerDefinitionCommand(program: Command) {
  const cmd = program
    .command('definition [file]')
    .alias('def')
    .description('Jump to definition of a symbol.')
    .configureHelp({ formatHelp: () => HELP });

  // ... options and action remain unchanged
}
```

### Root help structure (`jls --help`)

Written in `src/cli/index.ts` as `ROOT_HELP` constant.

```
Usage: jls <command> [options]

<一行项目描述>

Commands:
  <name>, <alias>   <一行描述>
  ...

Global Options:
  -p, --project <path>   Project root path
  --json-compact         Compact JSON (reduces token usage)
  ...

Typical workflows:
  # Explore an unknown class
  jls find UserService --kind Class
  jls sym src/.../UserService.java --flat
  jls ch src/.../UserService.java --method processOrder -d 2

  # Trace a method
  jls def Service.java --method process
  jls refs Service.java --method process
  jls impl Service.java --method process

Agent notes:
  - Start daemon first: jls daemon start --eager --init-project <path>
  - Use --json-compact to reduce token usage
  - On symbol ambiguity, retry with --index 0/1/2
  - Run jls <command> --help for command-specific usage
```

### Subcommand help structure (`jls <command> --help`)

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

### Parent command help (commands with subcommands)

**Rule: hand-write parent help only when subcommand selection requires context.** If a parent command's subcommands are self-explanatory (e.g., `jre status/download/remove`), keep commander's auto-generated output.

**When to hand-write:** Subcommands have non-obvious selection logic — e.g., `daemon` (health vs status, start --wait vs start --eager). The parent help should explain _which subcommand to pick for which situation_, not just list subcommand names.

Structure:
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

Run 'jls <parent> <subcommand> --help' for subcommand-specific options.
```

Each subcommand also gets its own inline HELP for `jls <parent> <sub> --help`.

### Files affected

| File | Change |
|------|--------|
| `src/cli/index.ts` | Add `ROOT_HELP` constant + `program.configureHelp()` |
| `src/cli/commands/definition.ts` | Add `HELP` constant + `.configureHelp()` |
| `src/cli/commands/references.ts` | Same |
| `src/cli/commands/hover.ts` | Same |
| `src/cli/commands/implementations.ts` | Same |
| `src/cli/commands/typeDefinition.ts` | Same |
| `src/cli/commands/workspaceSearch.ts` | Same (find command) |
| `src/cli/commands/symbols.ts` | Same |
| `src/cli/commands/commandHandlers.ts` | Same (call-hierarchy command) |
| `src/cli/commands/daemon.ts` | `DAEMON_HELP` + subcommand HELP for start/stop/status/etc. |
| `src/cli/commands/config.ts` | Subcommand HELP for init/show/path/defaults |
| `src/cli/commands/jre.ts` | Subcommand HELP for status/download/remove |
| `src/cli/commands/jdt.ts` | Subcommand HELP for status/update/remove |
| `src/cli/commands/cache.ts` | Subcommand HELP for stats/clean/warm |

### Non-goals (explicitly excluded)

- No new directories or files created
- No new dependencies (chalk, boxen, etc.)
- No automated tests for help output (manual visual check)
- No shared Agent-notes fragment extraction (each command independently maintained)
- Existing `docs/commands/` files are **preserved** — they remain the source of truth for content
