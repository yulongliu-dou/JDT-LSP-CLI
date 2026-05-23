export const CACHE_STATS_HELP = `
Usage: jls cache stats [options]

显示缓存统计信息（总大小、各 bucket 大小、scope 数量）。

Options:
  --format <fmt>   输出格式：table | json（默认 table）
  -h, --help       显示帮助

Examples:
  jls cache stats
  jls cache stats --format json
`;

export const CACHE_CLEAN_HELP = `
Usage: jls cache clean [options]

清理缓存条目。

Options:
  --stale                仅清理超过 TTL 的条目
  --all                  删除所有缓存条目
  --cache-ttl-days <n>   覆盖 TTL 天数
  -h, --help             显示帮助

Examples:
  jls cache clean --stale
  jls cache clean --stale --cache-ttl-days 3
  jls cache clean --all
`;

export const CACHE_WARM_HELP = `
Usage: jls cache warm [options]

预下载项目的直接依赖 sources jar 到缓存。

Options:
  --project <path>   项目根路径
  --timeout <ms>     单构件超时毫秒（默认 60000）
  -h, --help         显示帮助

Examples:
  jls cache warm
  jls cache warm --project /path/to/project
`;
