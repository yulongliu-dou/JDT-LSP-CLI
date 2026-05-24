export const CODE_ACTION_HELP = `
Usage: jls code-action <file> [options]

获取可用的快速修复和重构操作列表（import、提取方法、实现接口方法等）。

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
  jls action Service.java --method processOrder
`;
