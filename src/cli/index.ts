/**
 * CLI 命令注册
 * 
 * 统一注册所有 CLI 命令到 program
 */

import { Command } from 'commander';
import { registerDaemon } from './commands/daemon';
import { registerConfig } from './commands/config';
import { registerCallHierarchyCommand } from './commandHandlers';
import { registerDefinitionCommand } from './commands/definition';
import { registerReferencesCommand } from './commands/references';
import { registerSymbolsCommand } from './commands/symbols';
import { registerWorkspaceSymbolsCommand } from './commands/workspaceSearch';
import { registerTypeDefinitionCommand } from './commands/typeDefinition';
import { registerImplementationsCommand } from './commands/implementations';
import { registerHoverCommand } from './commands/hover';
import { registerCache } from './commands/cache';
import { registerJre } from './commands/jre';
import { registerJdt } from './commands/jdt';

// ── Help ──────────────────────────────────────────────────────────────────────

const ROOT_HELP = `
Usage: jls <command> [options]

基于 Eclipse JDT Language Server 的 Java 代码分析 CLI 工具。

Commands:
  find, f            全局搜索类、方法、字段
  symbols, sym       列出文件中的符号
  definition, def    跳转到符号定义
  references, refs   查找所有引用
  hover              获取 Javadoc 和类型信息
  call-hierarchy, ch 分析调用链
  implementations, impl 查找实现
  type-definition, typedef 跳转到类型定义
  daemon             管理后台守护进程
  cache              管理源码缓存和 Jar 解析
  config             查看/编辑配置
  jre                管理内嵌 JRE
  jdt                管理内嵌 JDT LS

Global Options:
  -p, --project <path>       项目根路径（LSP 命令必需，默认当前目录）
  --jdtls-path <path>        JDT LS 服务端路径
  --data-dir <path>          JDT LS 数据目录
  -v, --verbose              详细输出
  --timeout <ms>             命令超时毫秒（默认 60000）
  --no-daemon                禁用守护进程，每次命令启动新 JDT LS（较慢）
  --json-compact             紧凑 JSON 输出（减少 token 消耗）
  -o, --output <file>        输出到文件（UTF-8 编码）
  --source-download-mode <m> 源码下载模式：mvn | http | none（默认 mvn）
  --decompiler <kind>        反编译器：vineflower | cfr | none（默认 vineflower）
  --cache-ttl-days <n>       缓存 TTL 天数（0 = 不自动清理，默认 7）
  --no-library-resolve       禁用 Jar 类解析（调试逃生舱）
  -h, --help                 显示帮助
  --version                  显示版本号

Typical workflows:
  # 探索一个未知类
  jls find UserService --kind Class
  jls sym src/.../UserService.java --flat
  jls ch src/.../UserService.java --method processOrder -d 2

  # 追踪一个方法
  jls def Service.java --method process
  jls refs Service.java --method process
  jls impl Service.java --method process

Agent notes:
  - 先启动 daemon 以获得 10-100x 的速度提升：jls daemon start --eager --init-project <path>
  - 使用 --json-compact 减少 token 消耗
  - 符号歧义时使用 --index 0/1/2 重试
  - 运行 jls <command> --help 查看命令专属用法
`;

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * 注册所有 CLI 命令
 */
export function registerAllCommands(program: Command): void {
  // 接管全局 help 输出
  program.configureHelp({ formatHelp: () => ROOT_HELP });

  // 注册 daemon 命令
  registerDaemon(program);

  // 注册 config 命令
  registerConfig(program);

  // 注册 jre 命令
  registerJre(program);

  // 注册 jdt 命令
  registerJdt(program);

  // 注册 LSP 命令
  registerCallHierarchyCommand(program);
  registerDefinitionCommand(program);
  registerReferencesCommand(program);
  registerSymbolsCommand(program);
  registerWorkspaceSymbolsCommand(program);
  registerTypeDefinitionCommand(program);
  registerImplementationsCommand(program);
  registerHoverCommand(program);

  // 注册 cache 命令（SP04）
  registerCache(program);
}
