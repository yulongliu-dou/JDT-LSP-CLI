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
  jls refs Service.java --symbol status --kind Field --lifecycle
  jls refs Service.java --method process --no-declaration
  jls refs Service.java --symbol status --kind Field

Lifecycle mode (--lifecycle):
  输出结构: { summary, references[], hints, count }
  - summary.field: 字段基础信息 (name, type, containingClass)
  - summary.annotations: Lombok(@Data/@Getter/@Setter) / JSON(@JsonProperty/@SerializedName) / DB(@Column/@TableField/@Table) 三类注解映射
  - summary.accessStats: read/write 计数
  - summary.viaStats: direct/getter/setter 引用方式统计
  - summary.propagationTargets: 工作区内同名字段类
  - summary.enumMapping: 枚举值→描述映射表 (字段类型为枚举时)
  - summary.dtoChain: 跨模块 DTO 转换链路
  - summary.conditionalPaths: 条件分支下多路径复制摘要
  - references[].sourceLine: 引用所在行源码
  - references[].accessType: read | write | readWrite | unknown
  - references[].via: direct | getter | setter | reflection | unknown
  - references[].context.enclosingMethod / .enclosingClass / .branch: 引用上下文
  - references[].impact.value / .valueSource: 赋值影响
  - hints.propagationConfidence: full | partial | none
  - hints.sameNameFields[].confidence: high | medium | low (+ nextAction)
  - hints.reflectionRisk: 检测到的反射复制风险库
  - hints.unreachableViaJdtLs: 静态分析不可达的运行时路径

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;
