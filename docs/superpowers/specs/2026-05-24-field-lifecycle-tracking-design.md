---
name: field-lifecycle-tracking-design
description: refs --lifecycle 增强模式完整技术设计，含一期(refs+definition)和二期(callHierarchy)
metadata:
  type: design
  status: approved
  created: 2026-05-24
---

# 字段全生命周期追踪 — 技术设计文档

## 概述

面向 AI Agent 的 Java 代码分析场景，增强 CLI 现有命令，使 Agent 能够追踪一个字段从 DB 表列 → 实体类 → 中间 DTO → 出参 VO → JSON 序列化的完整生命周期。

### 设计原则

1. **能内部闭环的闭环解决** — 确定性信息直接返回
2. **不能闭环的返回高确定性线索** — 标注 confidence + 给出 nextAction
3. **非必要不新增命令** — 原有命令增强
4. **单次调用倾向** — 输出携带下一步参数，减少 Agent 往返
5. **失败可自愈** — 未知/不确定标注为 `"unknown"`，Agent 能据此决策

---

## 触发方式

**参数名：`--lifecycle`**

选择理由：AI Agent 从 help 文本直接理解"字段全生命周期追踪"语义，认知负担低。

```bash
jls refs --lifecycle --symbol status OrderEntity.java -p /path/to/project
```

---

## 输出结构（混合结构）

### 顶层结构

```json
{
  "success": true,
  "data": {
    "summary": { ... },
    "references": [ ... ]
  },
  "elapsed": 1234,
  "metadata": { ... }
}
```

`summary` 提供宏观方向判断，`references[]` 在原有 Location 基础上扁平扩展字段级语义。

---

## 第一部分：summary 摘要层

```json
"summary": {
  "field": {
    "name": "status",
    "type": "Integer",
    "containingClass": "com.example.lifecycle.entity.OrderEntity"
  },
  "annotations": {
    "lombok": [
      { "annotation": "@Data", "on": "class", "effect": "generates getter/setter for all fields" }
    ],
    "json": [
      { "annotation": "@JsonProperty", "value": "order_status", "location": "OrderDTO.status" },
      { "annotation": "@JsonProperty", "value": "order_status", "location": "OrderVO.status" }
    ],
    "db": [
      { "annotation": "@Column", "name": "order_status", "table": "t_order", "location": "OrderEntity.status" }
    ]
  },
  "accessStats": { "read": 8, "write": 7 },
  "viaStats": { "direct": 3, "getter": 8, "setter": 7 },
  "propagationTargets": [
    { "class": "com.example.lifecycle.dto.OrderDTO", "field": "status", "type": "Integer" },
    { "class": "com.example.lifecycle.dto.OrderRequest", "field": "status", "type": "Integer" },
    { "class": "com.example.lifecycle.vo.OrderVO", "field": "status", "type": "Integer" }
  ],
  "enumMapping": {
    "enumClass": "com.example.lifecycle.enums.OrderStatus",
    "constants": [
      { "name": "PENDING", "value": 0, "description": "待处理" },
      { "name": "CONFIRMED", "value": 1, "description": "已确认" }
    ],
    "resolverMethods": ["fromValue(int)", "fromDescription(String)"]
  },
  "dtoChain": {
    "chains": [
      {
        "path": "OrderRequest→OrderEntity→OrderDTO→OrderVO",
        "methods": ["requestToEntity", "entityToDto", "dtoToVo"]
      },
      {
        "path": "OrderEntity→OrderVO (备选)",
        "methods": ["entityToVoDirect"]
      }
    ]
  },
  "conditionalPaths": [
    {
      "method": "OrderService.createOrder",
      "branches": 3,
      "details": [
        { "condition": "if(isVip)", "assignment": "CONFIRMED(1)" },
        { "condition": "else if(isPrepaid)", "assignment": "PENDING(0)" },
        { "condition": "else", "assignment": "riskAssessment(request)" }
      ]
    }
  ]
}
```

### summary 设计要点

| 区块 | 用途 | Agent 使用方式 |
|------|------|---------------|
| `field` | 字段基础信息 | 确认追踪目标 |
| `annotations` | 三类注解（lombok/json/db） | 判断 JSON ↔ Java ↔ DB 列名映射关系 |
| `accessStats` | 读/写计数 | 快速判断字段被修改频率 |
| `viaStats` | 引用方式统计 | 了解 getter 打包程度 |
| `propagationTargets` | 工作区内同名字段类 | 知道还有哪些 class 有此字段，直接进入下一步追踪 |
| `enumMapping` | 枚举值→描述映射表（字段为枚举类型时出现） | 确认枚举值含义 |
| `dtoChain` | 转换链路全景 | 按图索骥，逐层追踪 |
| `conditionalPaths` | 条件分支摘要 | 了解在不同业务条件下字段被如何赋值 |

---

## 第二部分：references[] 扁平增强条目

每个条目在原有 `Location` 基础上增加字段级语义字段：

```json
{
  "uri": "file:///E:/.../service/OrderService.java",
  "range": { "start": { "line": 40, "character": 20 }, "end": { "line": 40, "character": 26 } },
  "sourceLine": "entity.setStatus(OrderStatus.CONFIRMED.getValue());",

  "accessType": "write",
  "via": "setter",
  "targetMethod": "OrderEntity.setStatus(Integer)",

  "context": {
    "enclosingMethod": "OrderService.createOrder",
    "enclosingClass": "com.example.lifecycle.service.OrderService",
    "branch": "if(isVip)"
  },

  "impact": {
    "value": "1",
    "valueSource": "OrderStatus.CONFIRMED.getValue()"
  }
}
```

### 新增字段说明

| 字段 | 类型 | 闭环程度 | 说明 |
|------|------|---------|------|
| `sourceLine` | `string` | **闭环** | 引用所在行源码，Agent 无需再读文件 |
| `accessType` | `"read" \| "write" \| "readWrite" \| "unknown"` | **闭环** | 通过 documentHighlight Read/Write kind + 赋值上下文判断 |
| `via` | `"direct" \| "getter" \| "setter" \| "reflection" \| "unknown"` | **闭环** | 字段引用方式；已知类型的都标注，无法判断时标注 `"unknown"` |
| `targetMethod` | `string \| null` | **闭环** | 当 via 为 getter/setter 时，指向实际调用的方法完整签名 |
| `context.enclosingMethod` | `string` | **闭环** | 引用所在方法名，documentSymbol 获取 |
| `context.enclosingClass` | `string` | **闭环** | 引用所在全限定类名 |
| `context.branch` | `string \| null` | **半闭环** | 如果在条件分支内，标注最近的条件表达式。源码文本搜索识别 |
| `impact.value` | `string \| null` | **线索** | 赋值语句右值的字面量/常量推断值 |
| `impact.valueSource` | `string \| null` | **线索** | 赋值来源表达式文本（如方法调用名） |

### 保留字段

来自原有 `Location` 的 `originalUri`、`originalRange`、`source`、`note`、`lockWaitMs`、`lineMapping` 均保留，不影响现有紧凑模式序列化逻辑。

---

## 第三部分：hints 线索层

对于不能内部闭环的痛点，在 `summary` 末尾增加 `hints` 区块：

```json
"hints": {
  "propagationConfidence": "partial",
  "sameNameFields": [
    {
      "class": "com.example.lifecycle.dto.OrderDTO",
      "field": "status",
      "confidence": "high",
      "reason": "OrderConverter.entityToDto 中发现 entity.getStatus()→dto.setStatus() 复制模式"
    },
    {
      "class": "com.example.lifecycle.dto.OrderRequest",
      "field": "status",
      "confidence": "medium",
      "reason": "OrderConverter.requestToEntity 中发现 request.getStatus()→entity.setStatus() 复制模式"
    }
  ],
  "unverifiedPropagations": [
    {
      "class": "TargetClass",
      "field": "fieldName",
      "confidence": "low",
      "reason": "同名字段但未检测到明确复制代码，可能通过 BeanUtils.copyProperties 或框架自动映射",
      "nextAction": "refs --lifecycle --symbol <field> <targetClass>"
    }
  ],
  "reflectionRisk": {
    "detectedLibraries": ["spring-beans"],
    "suspectedPatterns": ["BeanUtils.copyProperties"],
    "advice": "存在反射复制风险，使用 jls refs --lifecycle --symbol <field> <targetClass> 逐类确认"
  },
  "unreachableViaJdtLs": [
    {
      "concern": "JSON 反序列化入口",
      "detail": "@JsonProperty(\"order_status\") 运行时 Jackson 通过反射调用 setter，静态分析不可见",
      "agentAdvice": "结合运行时日志或 HTTP body 确认 JSON 反序列化路径"
    },
    {
      "concern": "DB ORM 字段映射",
      "detail": "@Column(name=\"order_status\") 运行时 JPA/MyBatis 通过反射赋值，静态分析不可见",
      "agentAdvice": "结合 SQL 日志确认 insert/update/select 中对列的读写"
    }
  ]
}
```

### hints 设计要点

| 区块 | 用途 |
|------|------|
| `sameNameFields[].confidence` | `high`（检测到复制代码）/ `medium`（命名惯例匹配）/ `low`（仅同名字段），Agent 按置信度决策 |
| `unverifiedPropagations[].nextAction` | 可直接复制执行的 CLI 命令 |
| `reflectionRisk` | 检测项目依赖中可能使用反射的库，提示隐式复制风险 |
| `unreachableViaJdtLs` | 明确告知"静态分析不可见"，防止 Agent 误判为"无引用" |

---

## Lombok 处理策略

JDT LS 内置 Lombok 支持（v1.9+），通过 ECJ 编译器的 annotation processing 自动处理。从项目 pom.xml 检测到 Lombok 依赖时，无需额外配置 `-javaagent`。

**关键限制**：`textDocument/references` 对字段的查询不会包含 getter/setter 方法调用。`--lifecycle` 的增强流程：

1. 解析字段声明文件的 documentSymbol，检测 `@Data`/`@Getter`/`@Setter` 注解或手写 getter/setter
2. 识别 getter/setter 方法（Lombok 生成的或手写的）
3. 对 getter/setter 方法调用 `textDocument/references`，获取所有调用点
4. 合并结果，标记 `via: "getter"` / `via: "setter"`
5. 将声明文件正文中的 getter/setter 方法也计入引用

---

## 一期：refs --lifecycle + definition 默认增强

### 范围

1. **`refs --lifecycle`** — 完整的 summary + 扁平 entries + hints 输出
2. **`definition` 默认增强** — 字段 def 结果附带注解信息（无需新参数）

### definition 增强输出

```json
{
  "definition": { "uri": "...", "range": {...} },
  "annotations": [
    { "name": "@Column", "attributes": { "name": "order_status" } },
    { "name": "@JsonProperty", "attributes": { "value": "order_status" } }
  ]
}
```

注解解析是轻量操作，符合"单次调用倾向"原则，默认输出。

---

## 二期：callHierarchy --lifecycle

### 概述

当前 `callHierarchy` 追踪方法级调用图。加上 `--lifecycle` 后，每个方法节点附带字段级读写信息。

### 输出结构

```json
{
  "method": "OrderConverter.entityToDto",
  "callees": [
    {
      "method": "OrderConverter.dtoToVo",
      "fieldFlow": {
        "reads": ["OrderDTO.status", "OrderDTO.amount"],
        "writes": ["OrderVO.status", "OrderVO.amount"]
      }
    }
  ]
}
```

### 与 refs --lifecycle 的配合

```
refs --lifecycle
  └→ 宏观视图: 字段出现在哪些类、哪些方法、被如何访问
      └→ dtoChain 给出转换方法列表
          └→ ch --lifecycle
              └→ 微观视图: 在转换调用链中，每一跳字段的读写变化
```

Agent 使用模式：先 `refs --lifecycle` 获取全景，再对关键转换链路调用 `ch --lifecycle` 深入追踪。
