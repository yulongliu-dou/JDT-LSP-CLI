export const SIGNATURE_HELP = `
Usage: jls signature-help <file> [options]

获取方法调用处的参数签名说明（参数名、类型、当前激活参数）。
agent 填写方法调用参数时，可验证参数类型是否匹配。

Options:
  --method <name>       方法名
  --symbol <name>       符号名
  --container <path>    父容器路径
  --signature <sig>     方法签名区分重载
  --index <n>           歧义索引
  --kind <type>         符号类型
  --global              全局搜索
  -h, --help            显示帮助

Examples:
  jls sig Service.java --method processOrder
`;
