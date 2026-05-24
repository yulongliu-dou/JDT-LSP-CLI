export const DOCUMENT_HIGHLIGHT_HELP = `
Usage: jls document-highlight <file> [options]

查找同一文件内所有对某符号的引用位置，区分 read/write/text 类型。
比 grep 更精确，限定在单文件范围。

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
  jls highlight Service.java --symbol myField --kind Field
`;
