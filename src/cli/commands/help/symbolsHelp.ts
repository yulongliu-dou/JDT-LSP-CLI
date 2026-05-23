export const SYMBOLS_HELP = `
Usage: jls symbols <file> [options]
       jls sym <file> [options]

列出文件中的所有符号（类、方法、字段等）。

Options:
  --flat       扁平化输出（去掉层次结构）
  -h, --help   显示帮助

Examples:
  jls sym src/main/java/com/example/Service.java
  jls sym src/main/java/com/example/Service.java --flat
`;
