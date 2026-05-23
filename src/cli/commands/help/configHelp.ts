export const INIT_HELP = `
Usage: jls config init [options]

创建默认配置文件 ~/.jdt-lsp/config.json。

Options:
  -f, --force   覆盖已有配置文件
  -h, --help    显示帮助

Examples:
  jls config init
  jls config init --force
`;

export const SHOW_HELP = `
Usage: jls config show

显示当前完整配置（JSON 格式）。
`;

export const PATH_HELP = `
Usage: jls config path

显示配置文件的绝对路径。
`;

export const DEFAULTS_HELP = `
Usage: jls config defaults

显示默认 JVM 配置。
`;
