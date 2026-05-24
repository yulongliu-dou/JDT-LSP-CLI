export const INLAY_HINT_HELP = `
Usage: jls inlay-hint <file> [options]

获取编译器推断的类型信息（var 推断类型、参数名标注）。
agent 阅读代码时补全隐式信息，减少猜测。

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
  jls inlay Service.java --method processOrder
`;
