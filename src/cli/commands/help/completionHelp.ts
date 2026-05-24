export const COMPLETION_HELP = `
Usage: jls completion <file> [options]

获取指定位置的补全候选列表（方法、字段、类名）。
agent 生成代码时可用于验证 API 存在性，或探索类的可用方法。

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
  jls complete Service.java --method processOrder
`;
