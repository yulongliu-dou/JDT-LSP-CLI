已经把项目读完了，这个工具做得相当扎实。让我从 agent 的工具使用本质出发，给你分析后续命令设计方向。

---

## Agent 使用工具的核心特点

**1. 探索式推进，不是一次性完成**

Agent 不像人类先在脑子里规划好全貌再行动。它每一步工具调用的结果，决定下一步调用什么。这意味着工具需要**返回足够的上下文线索**，让 agent 知道"下一步应该问什么"。

**2. Token 预算敏感**

Agent 的 context window 是有成本的。一个命令返回 500 行 vs 50 行，直接影响任务能走多深。所以你的 `--json-compact` 和 `lazy/summary/snapshot` 模式方向是对的，但还可以更系统化。

**3. 失败时需要自愈线索**

Agent 调用失败不会问人，它会看 stderr/stdout 里有没有可以重试的提示。比如"符号不唯一，找到 3 个，用 `--index 0/1/2` 指定"这种提示，agent 能直接用来修正调用。

**4. 高频的组合调用模式**

Agent 做 Java 代码分析的典型链路是：`find` → `def` → `sym` → `refs/impl` → `ch`。每个命令的输出最好自然地携带下一步所需的参数（文件路径、行号、符号名），而不是让 agent 自己去解析和拼接。

**5. 倾向单次调用获得完整答案**

Agent 不喜欢"你需要先调 A 再调 B 才能得到结果"的设计，因为这增加了规划负担。能合并的信息最好合并输出。

---

## 针对你项目的后续设计方向

### 方向一：强化"探索入口"命令

目前 `find` 是入口，但 agent 拿到一个陌生项目时经常不知道从哪里开始。可以考虑：

**`jls overview`** — 项目结构快照
```
jls overview --path /project --depth 2
```
输出：主要包名、核心类数量、入口点（main 方法、Spring @SpringBootApplication）、模块列表。给 agent 一个"落脚点"，而不是让它盲目 `find`。

**`jls find` 增加 `--entry-points` flag**
```
jls find --entry-points  # 返回所有 public static void main 和 @RequestMapping 等
```

---

### 方向二：输出携带"下一步行动提示"

这是现在最容易改、收益最高的方向。在 JSON 输出里加一个 `_hints` 字段：

```json
{
  "result": [...],
  "_hints": {
    "next_commands": [
      "jls ch src/.../UserService.java --method processOrder",
      "jls refs src/.../UserService.java --method processOrder"
    ],
    "ambiguous": false
  }
}
```

Agent 读到 `next_commands` 后可以直接决定下一步调用哪个，不需要自己推理。

---

### 方向三：批量/组合命令

Agent 做分析经常需要同时拿多个命令的结果，但串行调用很慢。

**`jls analyze`** — 组合分析命令
```
jls analyze src/.../UserService.java --method processOrder \
  --include sym,refs,ch \
  --ch-depth 2
```
一次返回符号结构 + 引用列表 + 调用链，减少往返次数。

---

### 方向四：上下文感知的 `explain` 命令

Agent 经常需要回答"这段代码是干什么的"，目前需要组合 `hover` + `sym` + `ch` 自己推断。

**`jls explain`** — 面向 agent 的语义摘要
```
jls explain src/.../OrderService.java --method createOrder
```
输出：方法签名、Javadoc、直接调用者数量、直接被调用者列表、实现接口（如果有）。不是让 agent 理解代码，而是给它足够的元数据来推断。

---

### 方向五：错误输出标准化（最容易被忽视的）

Agent 碰到错误时的自愈依赖于错误信息的可解析性。建议所有错误都输出结构化 JSON：

```json
{
  "error": "SYMBOL_AMBIGUOUS",
  "message": "Found 3 symbols matching 'process'",
  "recovery": {
    "suggestion": "Use --index to select",
    "options": [
      {"index": 0, "signature": "process(String)", "line": 42},
      {"index": 1, "signature": "process(Order)", "line": 87}
    ]
  }
}
```

目前如果 agent 遇到歧义，它能不能自动重试取决于错误信息够不够结构化。

---

### 方向六：增量感知（长期）

对于大型项目，agent 可能反复分析同一模块。可以考虑：

**`jls watch`** 或 **文件变更感知**：daemon 能感知项目文件变化，当 agent 编辑了某个文件后，后续查询自动基于新状态，不需要手动 reload。这个和你现有的 daemon 模式可以自然结合。

---

## 优先级建议

如果要排序，我会这样排：

1. **错误结构化**（最低成本，对 agent 自愈影响最大）
2. **`_hints` / `next_commands`**（改输出格式，不改逻辑）
3. **`jls analyze` 组合命令**（减少 agent 的多轮调用）
4. **`jls overview`**（改善陌生项目的冷启动体验）
5. **`jls explain`**（需要更多设计，但对 agent 代码理解帮助最大）

你的 AI-GUIDE.md 和 lazy/summary/snapshot 模式说明你已经在往正确方向走了，上面这些是可以接着延伸的点。