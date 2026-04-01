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

const program = new Command();

// 全局选项
program
  .name('jls')
  .description('Java LSP CLI - Fast Java language features for AI agents (with daemon support)')
  .version('1.6.8')
  .option('-p, --project <path>', 'Java project root directory', process.cwd())
  .option('--jdtls-path <path>', 'Path to eclipse.jdt.ls server')
  .option('--data-dir <path>', 'JDT LS data directory')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--timeout <ms>', 'Operation timeout in milliseconds', '60000')
  .option('--no-daemon', 'Disable daemon mode, start JDT LS for each command (slower)')
  .option('--json-compact', 'Output compact JSON (minimal fields)', false);

// ========== 新架构：注册所有命令 ==========
registerAllCommands(program);

// ========== 旧代码：已注释保留但不执行 ==========
// 以下代码已迁移到 cli/commands/ 和 cli/utils/ 目录
// 为安全起见暂时保留在此，确认新架构稳定后可删除

/*
// ========== 守护进程管理命令（已迁移到 cli/commands/daemon.ts）==========
const daemonCmd = program
  .command('daemon')
  .description('Manage the JDT LSP daemon process');

daemonCmd
  .command('start')
  .description('Start the daemon process')
  .option('--port <port>', 'Daemon port', String(DAEMON_PORT))
  .option('--eager', 'Pre-initialize project immediately (eliminates lazy loading delay)')
  .option('--init-project <path>', 'Project path to pre-initialize with --eager')
  .option('--wait', 'Wait for initialization to complete and show progress spinner')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const status = getDaemonStatus();
    if (status.running) {
      console.log(`Daemon already running with PID ${status.pid}`);
      process.exit(0);
    }
    
    console.log('Starting JDT LSP daemon...');
    
    // 支持预初始化
    const eagerOptions = cmdOpts.eager ? {
      eagerInit: true,
      projectPath: cmdOpts.initProject || opts.project,
      jdtlsPath: opts.jdtlsPath,
    } : undefined;
    
    // 如果使用了 --eager 和 --wait，使用 fork 启动子进程并显示进度
    if (cmdOpts.eager && cmdOpts.wait && eagerOptions?.projectPath) {
      try {
        await startDaemonWithFork(parseInt(cmdOpts.port), eagerOptions);
        process.exit(0); // 显式退出，避免事件循环阻塞
      } catch (err) {
        process.exit(1);
      }
    } else {
      // 传统模式：直接启动（前台运行）
      startDaemon(parseInt(cmdOpts.port), eagerOptions);
    }
  });

// ... [其余旧代码都以注释形式保留在这里]

*/

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供命令，显示帮助
if (process.argv.length <= 2) {
  program.help();
}
