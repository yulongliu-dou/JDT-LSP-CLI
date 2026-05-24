# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

jdt-lsp-cli 是一个面向 **本地 AI Agent** 的 Java 代码分析 CLI 工具，将 Eclipse JDT LSP 的能力封装为一次性命令行调用。Agent 通过 `jls` 命令执行定义跳转、引用查找、调用链分析等操作，获取结构化 JSON 结果。

核心设计目标：让 AI Agent 无需理解 LSP 协议、无需保持长连接，即可用最简单的方式消费 Java 语言智能。

## 4条设计原则

本项目所设计的输入和输出服务于 AI Agent 的使用特性，以下 4 条原则约束所有新增命令和输出格式的设计：

1. **探索式推进** — 每个命令的输出必须携带足够的上下文线索，让 agent 能判断"下一步该调什么"。不可假设 agent 提前规划好全貌。
2. **失败可自愈** — 所有错误输出必须是结构化 JSON，包含机器可读 `code`、人类可读 `message`、以及 `recovery`（suggestion + usage + examples）。Agent 应能直接解析错误并自动修正调用，无需人工介入。歧义场景必须列出所有候选项及其消歧参数。
3. **组合输出携带下一步参数** — Agent 高频链路是 `find → def → sym → refs/impl → ch`。每个命令的输出应自然地包含下一步所需的参数（文件路径、方法名、签名等），让 agent 直接拼接而非自行解析推断。
4. **单次调用倾向** — 能合并的信息合并输出，减少 agent 的规划负担和往返次数。避免"必须先调 A 再调 B"的强制多步设计。

## 渐进式文档索引

以下文档按需加载，覆盖日常开发所需的详细信息。**碰到对应场景时必须读取，不允许跳过。**

| 文档 | 强制读取条件 |
|------|-------------|
| [常用命令](docs/claude/commands-常用命令.md) | 执行任何 `npm run` / `npm test` / `jest` 命令前；不确定测试分层或构建流程时 |
| [架构设计](docs/claude/architecture-架构设计.md) | 修改 `src/` 下任何代码前；新增 CLI 命令、修改守护进程、调整执行流程时；理解双模式/符号定位/参数校验/Jar 源码解析等核心机制时 |
| [目录含义](docs/claude/directory-structure-目录含义.md) | 新增文件需要确定存放位置时；跨目录移动/重构模块时；对某个 `src/` 子目录职责不明确时 |
| [升级版本流程](docs/claude/release-process-升级版本流程.md) | 修改 `package.json` 版本号、执行 `npm publish`、运行 `update-version` 脚本、或新增/变更文档文件时 |
| [内嵌 Help 系统规范](docs/claude/help-system-内嵌帮助规范.md) | 新增 CLI 命令、增删改命令选项/参数时 |
| [探路脚本](docs/claude/explore-scripts-探路脚本.md) | 接入新的 LSP 功能、设计新 CLI 命令前需要了解 JDT LS 原始返回数据格式时 |
