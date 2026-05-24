export const DECLARATION_HELP = `
Usage: jls declaration <file> [options]

跳转到符号的声明位置（declaration），与 definition 的区别：
- definition：跳转到符号的完整定义（方法体、类体等）
- declaration：仅跳转到声明（抽象方法声明、接口方法声明等）

对于具体类中的方法，declaration 通常指向接口中的方法声明；
对于接口方法，declaration 返回自身。

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
  jls decl Service.java --method findById
  jls decl Service.java --symbol "MyInterface.findById" --kind Method
`;
