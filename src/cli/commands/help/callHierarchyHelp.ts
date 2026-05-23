export const CH_HELP = `
Usage: jls call-hierarchy <file> [options]
       jls ch <file> [options]

分析方法调用链（outgoing 调用关系 / incoming 被调用关系）。

Options:
  -d, --depth <n>           最大递归深度（默认 3）
  --incoming                获取被调用关系（默认 outgoing）
  --method <name>           方法名（自动解析位置）
  --symbol <name>           符号名（自动解析位置）
  --container <path>        父容器路径，如 "MyClass.myMethod"
  --signature <sig>         方法签名区分重载，如 "(String, int)"
  --index <n>               多个匹配时选择（从 0 开始）
  --kind <type>             符号类型：Method | Field | Class | Interface
  --global                  全局搜索（需同时指定 --symbol 和 --kind）

  --mode <type>             查询模式：legacy | lazy | snapshot | summary（默认 legacy）
  --cursor <id>             游标 ID，lazy 模式继续查询
  --fetch-source <ids>      逗号分隔方法 ID，lazy 模式获取源码
  --expand-depth <ids>      逗号分隔方法 ID，lazy 模式展开子调用
  --snapshot-path <path>    snapshot 模式输出路径
  --max-summary-depth <n>   summary 模式最大深度（默认 2）
  -h, --help                显示帮助

Examples:
  jls ch Service.java --method processOrder -d 3
  jls ch Service.java --method process --incoming
  jls ch Service.java --method process --mode summary
  jls ch Service.java --method process --mode snapshot --snapshot-path ./out

Modes:
  legacy    完整遍历调用链返回所有结果
  lazy      分批返回，通过 cursor 继续查询
  summary   仅返回摘要和统计
  snapshot  生成 HTML 可视化调用图

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;
