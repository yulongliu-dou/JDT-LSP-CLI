# 全局选项

所有 `jls` 命令都可以使用以下全局选项。

## 选项列表

| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--project <path>` | `-p` | Java 项目根目录 | 当前目录 |
| `--jdtls-path <path>` | | JDT Language Server 路径 | 自动查找 |
| `--data-dir <path>` | | JDT LS 数据目录 | 自动生成 |
| `--verbose` | `-v` | 启用详细日志输出 | `false` |
| `--timeout <ms>` | | 操作超时时间（毫秒） | `60000` |
| `--no-daemon` | | 禁用守护进程模式，每次启动新的 JDT LS | `false` |
| `--json-compact` | | 输出紧凑 JSON（最小化字段） | `false` |
| `--output <file>` | `-o` | 将输出写入文件（UTF-8 编码） | 标准输出 |
| `--version` | `-V` | 显示版本号 | - |
| `--help` | `-h` | 显示帮助信息 | - |

## 选项详解

### --project, -p

指定 Java 项目的根目录路径。所有相对路径都基于此目录解析。

```bash
# 使用绝对路径
jls -p E:\mybatis-3-master find SqlSession

# 使用相对路径（基于当前目录）
jls -p ../my-project find MyClass
```

### --jdtls-path

手动指定 Eclipse JDT Language Server 的路径。通常不需要设置，工具会自动查找。

```bash
jls --jdtls-path /path/to/jdt-ls/plugins/org.eclipse.jdt.ls.core_*.jar find MyClass
```

### --data-dir

指定 JDT LS 的工作数据目录。默认会自动生成。

```bash
jls --data-dir /tmp/jdt-data find MyClass
```

### --verbose, -v

启用详细日志输出，用于调试。

```bash
jls -v find SqlSession
```

### --timeout

设置操作超时时间（毫秒）。对于大型项目或复杂查询，可能需要增加超时时间。

```bash
# 设置超时为 2 分钟
jls --timeout 120000 find MyClass
```

### --no-daemon

禁用守护进程模式。每次执行命令时都会启动新的 JDT LS 实例，速度较慢但不需要管理守护进程。

```bash
# 使用守护进程模式（默认，快速）
jls find MyClass

# 使用直接模式（慢速，无需管理守护进程）
jls --no-daemon find MyClass
```

### --json-compact

输出紧凑格式的 JSON，减少输出体积，适合 AI Agent 使用。

```bash
# 标准输出（包含完整信息）
jls def MyClass.java --method getName

# 紧凑输出（仅包含必要字段）
jls def MyClass.java --method getName --json-compact
```

**各命令的紧凑字段映射：**

| 命令 | 保留字段 |
|------|----------|
| `definition` | `uri`, `range.start` |
| `references` | `uri`, `range.start.line` |
| `symbols` | `name`, `kind`, `range.start.line` |
| `call-hierarchy` | `entry`, `calls`, `totalMethods` |
| `hover` | `contents` |
| `implementations` | `uri`, `range.start.line` |
| `type-definition` | `uri`, `range.start.line` |

### --output, -o

将输出写入指定文件（UTF-8 编码），解决 PowerShell 的 UTF-16 LE 编码问题。

```bash
# 输出到文件
jls find SqlSession --output result.json

# 查看文件内容
cat result.json
```

## 使用建议

1. **项目路径**: 始终使用 `-p` 指定项目根目录，避免路径解析错误
2. **守护进程**: 频繁使用时启用守护进程模式（默认），性能提升 10-100 倍
3. **紧凑输出**: AI Agent 集成时使用 `--json-compact` 减少 token 消耗
4. **超时设置**: 大型项目建议设置 `--timeout 120000`（2 分钟）
5. **输出文件**: 在 PowerShell 中使用 `-o` 避免编码问题
