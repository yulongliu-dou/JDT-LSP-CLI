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
import { save as saveDaemonConfig } from './libraryProvider/daemonConfigStore';
import type { SourceDownloadMode, DecompilerKind } from './libraryProvider/config';

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
  .option('-o, --output <file>', 'Write output to file with UTF-8 encoding (bypasses PowerShell UTF-16 LE issue)')
  // SP04：library provider 全局配置
  .option('--source-download-mode <mode>', 'Sources download mode: mvn|http|none', 'mvn')
  .option('--decompiler <kind>', 'Decompiler: vineflower|cfr|none', 'vineflower')
  .option('--cache-ttl-days <n>', 'Cache TTL in days (0 = no auto-clean)', '7')
  .option('--no-library-resolve', 'Disable jar class resolution (debug escape hatch)');

// ========== 新架构：注册所有命令 ==========
registerAllCommands(program);

// 解析命令行参数
program.parse(process.argv);

// SP04：将 library-resolve 相关全局选项持久化到 daemon-config
// 供后续命令（包括 daemon 模式）复用
const opts = program.opts();
if (opts.sourceDownloadMode || opts.decompiler || opts.cacheTtlDays || !opts.libraryResolve) {
  const partial: Record<string, unknown> = {};
  if (opts.sourceDownloadMode && ['mvn', 'http', 'none'].includes(opts.sourceDownloadMode)) {
    partial.sourceDownloadMode = opts.sourceDownloadMode as SourceDownloadMode;
  }
  if (opts.decompiler && ['vineflower', 'cfr', 'none'].includes(opts.decompiler)) {
    partial.decompiler = opts.decompiler as DecompilerKind;
  }
  const ttl = parseInt(opts.cacheTtlDays, 10);
  if (!isNaN(ttl) && ttl >= 0) {
    partial.cacheTtlDays = ttl;
  }
  if (opts.libraryResolve === false) {
    // --no-library-resolve 会将 libraryResolve 设为 false
    partial.libraryResolveEnabled = false;
  }
  if (Object.keys(partial).length > 0) {
    saveDaemonConfig(partial as any);
  }
}

// 如果没有提供命令，显示帮助
if (process.argv.length <= 2) {
  program.help();
}
