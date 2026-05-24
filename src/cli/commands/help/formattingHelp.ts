export const FORMATTING_HELP = `
Usage: jls formatting <file>

获取文件的格式化编辑列表（TextEdit 数组）。
返回每个需要修改的位置的 range 和替换文本（newText）。

Options:
  -h, --help             显示帮助

Examples:
  jls fmt src/main/java/com/example/Service.java
`;
