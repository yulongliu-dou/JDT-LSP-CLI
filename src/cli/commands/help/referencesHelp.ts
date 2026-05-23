export const REFERENCES_HELP = `
Usage: jls references <file> [options]
       jls refs <file> [options]

查找符号的所有引用。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器路径，如 "MyClass.myMethod"
  --signature <sig>     方法签名区分重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         符号类型：Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  --no-declaration      排除声明本身
  -h, --help            显示帮助

Examples:
  jls refs Service.java --method processOrder
  jls refs Service.java --method process --no-declaration
  jls refs Service.java --symbol myField

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;
