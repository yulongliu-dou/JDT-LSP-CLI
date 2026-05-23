export const FIND_HELP = `
Usage: jls find <query> [options]
       jls f <query> [options]

全局搜索类、方法、字段。

Options:
  --kind <type>   按符号类型过滤：Class | Method | Field | Interface ...
  --limit <n>     最大结果数（默认 50）
  -h, --help      显示帮助

Examples:
  jls find UserService
  jls find ArrayList --kind Class
  jls find process --kind Method --limit 20

On ambiguity:
  用 --kind 缩小搜索范围。
  如果无结果且查询看起来像 JDK 类，工具会自动提示。
`;
