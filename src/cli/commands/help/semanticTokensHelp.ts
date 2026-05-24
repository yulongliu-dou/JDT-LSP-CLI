export const SEMANTIC_TOKENS_HELP = `
Usage: jls semantic-tokens <file> [options]

返回文件中每个 token 的精确类型（method、variable、class、parameter…）。
grep 搜 "process" 无法区分方法调用、变量名、字符串，semantic-tokens 能精确消歧。

Options:
  --method <name>       方法名（可选，用于定位后获取 tokens）
  --symbol <name>       符号名（可选）
  --container <path>    父容器路径
  --signature <sig>     方法签名区分重载
  --index <n>           歧义索引
  --kind <type>         符号类型
  --global              全局搜索
  -h, --help            显示帮助

Examples:
  jls semtok Service.java
  jls semtok Service.java --method processOrder
`;
