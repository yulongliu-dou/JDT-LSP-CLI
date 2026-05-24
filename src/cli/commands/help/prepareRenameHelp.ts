export const PREPARE_RENAME_HELP = `
Usage: jls prepare-rename <file> [options]

检查指定位置是否可以重命名，返回可重命名的符号范围。
- 如果位置有效：返回 range 和 valid: true
- 如果位置无效（不可重命名）：返回 valid: false

在调用 rename 之前可先用此命令验证目标位置是否支持重命名。

Options:
  -h, --help             显示帮助
  --symbol <name>        符号名称（自动定位）
  --method <name>        方法名称（自动定位）
  --container <path>     父容器路径，如 "MyClass.innerMethod"
  --signature <sig>      方法签名，如 "(String, int)"
  --index <n>            同名符号索引（0-based）
  --kind <type>          符号类型：Method, Field, Class, Interface
  --global               全局搜索（需配合 --symbol 和 --kind）

Examples:
  jls preren Service.java --method findById
  jls preren Service.java --symbol myField --kind Field
`;
