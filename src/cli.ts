#!/usr/bin/env node
/**
 * JDT LSP CLI - 命令行入口（简化版）
 * 
 * 支持两种运行模式：
 * 1. 守护进程模式（默认）：通过 HTTP 与常驻的 JDT LS 进程通信，响应快
 * 2. 直接模式（--no-daemon）：每次命令启动新的 JDT LS 进程，响应慢但无需管理守护进程
 * 
 * 架构说明：
 * - 本文件仅保留全局选项定义和命令注册
 * - 所有命令逻辑已迁移到 cli/commands/ 目录
 * - 公共函数已提取到 cli/utils/ 目录
 */

import { Command } from 'commander';
import { registerAllCommands } from './cli/index';
import { PACKAGE_VERSION } from './core/constants';

const program = new Command();

// 全局选项
program
  .name('jls')
  .description('Java LSP CLI - Fast Java language features for AI agents (with daemon support)')
  .version(PACKAGE_VERSION)
  .option('-p, --project <path>', 'Java project root directory', process.cwd())
  .option('--jdtls-path <path>', 'Path to eclipse.jdt.ls server')
  .option('--data-dir <path>', 'JDT LS data directory')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--timeout <ms>', 'Operation timeout in milliseconds', '60000')
  .option('--no-daemon', 'Disable daemon mode, start JDT LS for each command (slower)')
  .option('--json-compact', 'Output compact JSON (minimal fields)', false)
  .option('-o, --output <file>', 'Write output to file with UTF-8 encoding (bypasses PowerShell UTF-16 LE issue)');

// ========== 新架构：注册所有命令 ==========
registerAllCommands(program);

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供命令，显示帮助
if (process.argv.length <= 2) {
  program.help();
}
