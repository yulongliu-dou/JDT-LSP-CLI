export const IMPLEMENTATIONS_HELP = `
Usage: jls implementations <file> [options]
       jls impl <file> [options]

查找接口或抽象类的实现。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器路径，如 "MyClass.myMethod"
  --signature <sig>     方法签名区分重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         符号类型：Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  -h, --help            显示帮助

Examples:
  jls impl Service.java --method process
  jls impl --global --symbol UserRepository --kind Interface

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
`;
