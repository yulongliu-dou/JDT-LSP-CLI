export const REFERENCES_HELP = `
Usage: jls references <file> [options]
       jls refs <file> [options]

查找符号的所有引用。使用 --lifecycle 进入字段全生命周期追踪模式。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器路径，如 "MyClass.myMethod"
  --signature <sig>     方法签名区分重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         符号类型：Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  --no-declaration      排除声明本身
  --lifecycle           字段全生命周期追踪（annotations, read/write, propagation, DTO chain, hints）
  -h, --help            显示帮助

Examples:
  jls refs Service.java --method processOrder
  jls refs Service.java --symbol status --lifecycle
  jls refs Service.java --method process --no-declaration

Lifecycle mode (--lifecycle):
  Output: { summary, references[], hints }
  - summary.annotations: Lombok/JSON/DB annotation mapping
  - summary.propagationTargets: same-name fields in workspace
  - summary.dtoChain: cross-module DTO transformation chains
  - references[].accessType: read | write | readWrite | unknown
  - references[].via: direct | getter | setter | reflection | unknown
  - references[].context: enclosingMethod + branch
  - hints: reasoning clues for uncertain scenarios (confidence + nextAction)

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;
