export const DIAGNOSTICS_HELP = `
Usage: jls diagnostics <file> [options]

获取 Java 文件的编译错误和警告列表。

Options:
  -h, --help            显示帮助

Examples:
  jls diagnostics src/main/java/com/example/Service.java
  jls diag Service.java --project ./my-project
`;
