export const DAEMON_HELP = `
Usage: jls daemon <subcommand> [options]

管理后台 JDT LS 守护进程。启动 daemon 可将命令延迟从 30-60s 降至 5-500ms。

Subcommands:
  start               启动守护进程（推荐 --eager 预初始化项目）
  stop                停止运行中的守护进程
  status              查看进程状态、运行时间、已连接项目
  memory              查看当前内存快照和压力级别
  list                列出所有已加载的项目
  release [project]   释放已加载项目（释放内存）
  stop-project        优雅停止一个已加载项目（等待进行中请求完成）
  config              热更新运行时配置（如 auto-scaling）

Typical usage:
  # 首次启动（推荐）
  jls daemon start --eager --init-project /path/to/project --wait

  # 日常检查
  jls daemon status -v

Agent notes:
  - 启动前先 jls daemon status 检查，避免重复启动
  - status -v 返回完整 JSON 包含 pid、uptime、project 列表
  - start --wait 会阻塞直到 LSP 完全就绪（推荐首次使用）

Run 'jls daemon <subcommand> --help' for subcommand-specific options.
`;

export const START_HELP = `
Usage: jls daemon start [options]

启动后台守护进程。

Options:
  --port <n>               守护进程端口（默认自动分配）
  --eager                  立即预初始化连接到 JDT LS
  --init-project <path>    启动时预初始化的项目路径
  --wait                   阻塞等待 LSP 完全就绪
  -h, --help               显示帮助

Examples:
  jls daemon start --eager --init-project /my/project --wait
  jls daemon start --eager

Notes:
  - 不加 --eager 时，LSP 在收到第一个命令时才初始化（30-60s 延迟）
  - --wait 需要配合 --eager 使用，初始化失败时 exit code 为 1
`;

export const STOP_HELP = `
Usage: jls daemon stop

停止运行中的守护进程。

如果未在运行，exit code 为 0（幂等操作）。
`;

export const STATUS_HELP = `
Usage: jls daemon status [options]

查看守护进程状态。

Options:
  -v, --verbose   显示详细信息（内存、auto-scaling、项目详情）
  -h, --help      显示帮助

Examples:
  jls daemon status
  jls daemon status -v
`;

export const MEMORY_HELP = `
Usage: jls daemon memory

显示当前内存快照和压力级别。

需要守护进程在运行中。
`;

export const LIST_HELP = `
Usage: jls daemon list

列出所有当前已加载的项目及其状态。

需要守护进程在运行中。
`;

export const RELEASE_HELP = `
Usage: jls daemon release [project]

释放一个已加载的项目（释放其占用的内存）。

如果没有指定 project，释放所有项目。
`;

export const STOP_PROJECT_HELP = `
Usage: jls daemon stop-project <projectPath> [options]

优雅停止一个已加载项目，等待进行中的请求完成后再断开。

Options:
  --force    跳过等待，立即强制停止
  -h, --help 显示帮助

Examples:
  jls daemon stop-project /path/to/project
  jls daemon stop-project /path/to/project --force
`;

export const DAEMON_CONFIG_HELP = `
Usage: jls daemon config [options]

热更新守护进程运行时配置（无需重启）。

Options:
  --auto-scaling <key=value>  设置 auto-scaling 配置，如 enabled=false
  --key <key>                 任意配置键（支持点号分隔）
  --value <value>             配置值
  -h, --help                  显示帮助

Examples:
  jls daemon config --auto-scaling enabled=false
  jls daemon config --key cacheTtlDays --value 14
`;
