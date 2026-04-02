/**
 * Daemon 命令处理
 * 
 * 负责：
 * - 启动/停止/检查守护进程状态
 * - 显示守护进程信息
 * - 项目管理
 */

import { Command } from 'commander';
import { createSpinner } from 'nanospinner';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import {
  startDaemon,
  getDaemonStatus,
  stopDaemon,
  DAEMON_PORT,
} from '../../daemon';
import { InitProgress } from '../../core/types';
import { sendDaemonRequest } from '../utils/daemonRequest';

/**
 * 注册 daemon 命令
 */
export function registerDaemon(program: Command): void {
  const daemonCmd = program
    .command('daemon')
    .description('Manage the JDT LSP daemon process');

  // daemon start
  daemonCmd
    .command('start')
    .description('Start the daemon process')
    .option('--port <port>', 'Daemon port', String(DAEMON_PORT))
    .option('--eager', 'Pre-initialize project immediately')
    .option('--init-project <path>', 'Project path to pre-initialize')
    .option('--wait', 'Wait for initialization to complete')
    .action(async (cmdOpts) => {
      const opts = program.opts();
      const status = getDaemonStatus();
      
      if (status.running) {
        console.log(`Daemon already running with PID ${status.pid}`);
        process.exit(0);
      }
      
      console.log('Starting JDT LSP daemon...');
      
      const eagerOptions = cmdOpts.eager ? {
        eagerInit: true,
        projectPath: cmdOpts.initProject || opts.project,
        jdtlsPath: opts.jdtlsPath,
      } : undefined;
      
      if (cmdOpts.eager && cmdOpts.wait && eagerOptions?.projectPath) {
        await startDaemonWithFork(parseInt(cmdOpts.port), eagerOptions);
        process.exit(0);
      } else {
        startDaemon(parseInt(cmdOpts.port), eagerOptions);
      }
    });

  // daemon stop
  daemonCmd
    .command('stop')
    .description('Stop the daemon process')
    .action(() => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Daemon is not running');
        process.exit(0);
      }
      
      if (stopDaemon()) {
        console.log(`Daemon stopped (was PID ${status.pid})`);
      } else {
        console.error('Failed to stop daemon');
        process.exit(1);
      }
    });

  // daemon status
  daemonCmd
    .command('status')
    .description('Check daemon status')
    .action(async () => {
      const status = getDaemonStatus();
      
      if (!status.running) {
        console.log('Daemon status: NOT RUNNING');
        console.log(`Port: ${status.port}`);
        console.log('\nStart with: jls daemon start');
        process.exit(0);
      }
      
      console.log('Daemon status: RUNNING');
      console.log(`PID: ${status.pid}`);
      console.log(`Port: ${status.port}`);
      
      try {
        const result = await sendDaemonRequest('/status', {});
        if (result.success && result.data) {
          const projectPath = result.data.project?.path || result.data.project || 'none';
          console.log(`Project: ${projectPath}`);
          console.log(`Status: ${result.data.status}`);
          console.log(`Uptime: ${Math.floor(result.data.uptime)}s`);
          if (result.data.version) {
            console.log(`Version: ${result.data.version}`);
          }
        }
      } catch (e) {
        // ignore
      }
    });

  // daemon list
  daemonCmd
    .command('list')
    .description('List all loaded projects')
    .action(async () => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Daemon is not running');
        process.exit(1);
      }
      
      try {
        const result = await sendDaemonRequest('/projects', {});
        if (result.success && result.data) {
          const projects = result.data.projects || [];
          if (projects.length === 0) {
            console.log('No projects loaded');
          } else {
            console.log(`Loaded projects (${projects.length}):`);
            for (const p of projects) {
              const age = Math.floor((Date.now() - p.lastAccess) / 1000);
              console.log(`  ${p.path}`);
              console.log(`    Status: ${p.status}, Priority: ${p.priority}, Last access: ${age}s ago`);
            }
          }
        }
      } catch (e) {
        console.error('Failed to get project list');
      }
    });

  // daemon release
  daemonCmd
    .command('release [project]')
    .description('Release a loaded project (free memory)')
    .action(async (project: string | undefined) => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Daemon is not running');
        process.exit(1);
      }
      
      try {
        const result = await sendDaemonRequest('/release', { project });
        if (result.success) {
          console.log('Project released');
        } else {
          console.error('Failed to release project');
          process.exit(1);
        }
      } catch (e) {
        console.error('Failed to release project');
        process.exit(1);
      }
    });
}

/**
 * 使用 spawn 启动守护进程子进程，显示进度后退出
 */
async function startDaemonWithFork(
  port: number,
  options: { eagerInit: boolean; projectPath: string; jdtlsPath?: string }
): Promise<void> {
  const spinner = createSpinner('启动守护进程...').start();
  const startTime = Date.now();
  
  const env = {
    ...process.env,
    JLS_DAEMON_PORT: String(port),
    JLS_DAEMON_EAGER: 'true',
    JLS_DAEMON_PROJECT: options.projectPath,
    JLS_DAEMON_JDTLS: options.jdtlsPath || '',
  };
  
  const daemonPath = path.join(__dirname, '..', '..', 'daemon-process.js');
  const child: ChildProcess = spawn(process.execPath, [daemonPath], {
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  
  return new Promise((resolve, reject) => {
    let initCompleted = false;
    
    child.on('message', (msg: any) => {
      if (msg.type === 'progress') {
        const progress: InitProgress = msg.data;
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        spinner.update({ text: `${progress.message} (${progress.percent}%) - ${elapsedSec}s` });
      } else if (msg.type === 'ready') {
        initCompleted = true;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        spinner.success({ text: `JDT LS 就绪！(${elapsed}s)` });
        console.log(`项目：${msg.data.projectPath}`);
        if (msg.data.loadTime) {
          console.log(`加载耗时：${msg.data.loadTime}ms`);
        }
        console.log(`PID: ${msg.data.pid}`);
        
        child.disconnect();
        child.unref();
        
        resolve();
      } else if (msg.type === 'error') {
        initCompleted = true;
        spinner.error({ text: `初始化失败：${msg.data.error}` });
        child.kill();
        reject(new Error(msg.data.error));
      }
    });
    
    child.on('error', (err) => {
      if (!initCompleted) {
        spinner.error({ text: '守护进程启动失败' });
        reject(err);
      }
    });
    
    child.on('exit', (code) => {
      if (!initCompleted && code !== 0) {
        spinner.error({ text: `守护进程异常退出 (code: ${code})` });
        reject(new Error(`Daemon exited with code ${code}`));
      }
    });
    
    setTimeout(() => {
      if (!initCompleted) {
        spinner.error({ text: '初始化超时 (>120s)' });
        child.kill();
        reject(new Error('Initialization timeout'));
      }
    }, 120000);
  });
}
