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
import { validateDaemonOptions } from '../../core/utils/daemonValidation';

// ── Help ──────────────────────────────────────────────────────────────────────

const DAEMON_HELP = `
Usage: jls daemon <subcommand> [options]

管理后台 JDT LS 守护进程。启动 daemon 可将命令延迟从 30-60s 降至 5-500ms。

Subcommands:
  start               启动守护进程（推荐 --eager 预初始化项目）
  stop                停止运行中的守护进程
  status              查看进程状态、运行时间、已连接项目
  memory              查看当前内存快照和压力级别
  list                列出所有已加载的项目
  release [project]   释放已加载项目（释放内存）
  stop-project        优雅停止一个已加载项目（等待进行中请求完成）
  config              热更新运行时配置（如 auto-scaling）

Typical usage:
  # 首次启动（推荐）
  jls daemon start --eager --init-project /path/to/project --wait

  # 日常检查
  jls daemon status -v

Agent notes:
  - 启动前先 jls daemon status 检查，避免重复启动
  - status -v 返回完整 JSON 包含 pid、uptime、project 列表
  - start --wait 会阻塞直到 LSP 完全就绪（推荐首次使用）

Run 'jls daemon <subcommand> --help' for subcommand-specific options.
`;

const START_HELP = `
Usage: jls daemon start [options]

启动后台守护进程。

Options:
  --port <n>               守护进程端口（默认自动分配）
  --eager                  立即预初始化连接到 JDT LS
  --init-project <path>    启动时预初始化的项目路径
  --wait                   阻塞等待 LSP 完全就绪
  -h, --help               显示帮助

Examples:
  jls daemon start --eager --init-project /my/project --wait
  jls daemon start --eager

Notes:
  - 不加 --eager 时，LSP 在收到第一个命令时才初始化（30-60s 延迟）
  - --wait 需要配合 --eager 使用，初始化失败时 exit code 为 1
`;

const STOP_HELP = `
Usage: jls daemon stop

停止运行中的守护进程。

如果未在运行，exit code 为 0（幂等操作）。
`;

const STATUS_HELP = `
Usage: jls daemon status [options]

查看守护进程状态。

Options:
  -v, --verbose   显示详细信息（内存、auto-scaling、项目详情）
  -h, --help      显示帮助

Examples:
  jls daemon status
  jls daemon status -v
`;

const MEMORY_HELP = `
Usage: jls daemon memory

显示当前内存快照和压力级别。

需要守护进程在运行中。
`;

const LIST_HELP = `
Usage: jls daemon list

列出所有当前已加载的项目及其状态。

需要守护进程在运行中。
`;

const RELEASE_HELP = `
Usage: jls daemon release [project]

释放一个已加载的项目（释放其占用的内存）。

如果没有指定 project，释放所有项目。
`;

const STOP_PROJECT_HELP = `
Usage: jls daemon stop-project <projectPath> [options]

优雅停止一个已加载项目，等待进行中的请求完成后再断开。

Options:
  --force    跳过等待，立即强制停止
  -h, --help 显示帮助

Examples:
  jls daemon stop-project /path/to/project
  jls daemon stop-project /path/to/project --force
`;

const DAEMON_CONFIG_HELP = `
Usage: jls daemon config [options]

热更新守护进程运行时配置（无需重启）。

Options:
  --auto-scaling <key=value>  设置 auto-scaling 配置，如 enabled=false
  --key <key>                 任意配置键（支持点号分隔）
  --value <value>             配置值
  -h, --help                  显示帮助

Examples:
  jls daemon config --auto-scaling enabled=false
  jls daemon config --key cacheTtlDays --value 14
`;

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * 将日期格式化为统一的 ISO-like 字符串：YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 解析 CLI 传入的配置值为合适的类型（bool / number / string）
 */
function parseConfigValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  return raw;
}

/**
 * 注册 daemon 命令
 */
export function registerDaemon(program: Command): void {
  const daemonCmd = program
    .command('daemon')
    .description('管理后台 JDT LS 守护进程。')
    .configureHelp({ formatHelp: () => DAEMON_HELP });

  // daemon start
  daemonCmd
    .command('start')
    .description('启动守护进程。')
    .configureHelp({ formatHelp: () => START_HELP })
    .option('--port <port>', 'Daemon port', String(DAEMON_PORT))
    .option('--eager', 'Pre-initialize project immediately')
    .option('--init-project <path>', 'Project path to pre-initialize')
    .option('--wait', 'Wait for initialization to complete')
    .action(async (cmdOpts) => {
      const opts = program.opts();

      // 第1层：CLI 前置校验（格式、范围、组合关系）
      const validation = validateDaemonOptions(cmdOpts, opts);
      if (!validation.valid) {
        console.error(`❌ 参数错误: ${validation.error}`);
        if (validation.suggestion) {
          console.error(`💡 ${validation.suggestion}`);
        }
        process.exit(1);
      }
      if (validation.warnings) {
        for (const w of validation.warnings) {
          console.warn(`⚠️  ${w}`);
        }
      }

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

      const port = parseInt(cmdOpts.port, 10);

      if (cmdOpts.eager && cmdOpts.wait && eagerOptions?.projectPath) {
        await startDaemonWithFork(port, eagerOptions);
        process.exit(0);
      } else {
        startDaemon(port, eagerOptions).catch((err: any) => {
          console.error('❌ 守护进程启动失败:', err.message || err);
          process.exit(1);
        });
      }
    });

  // daemon stop
  daemonCmd
    .command('stop')
    .description('停止守护进程。')
    .configureHelp({ formatHelp: () => STOP_HELP })
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
    .description('查看守护进程状态。')
    .configureHelp({ formatHelp: () => STATUS_HELP })
    .option('-v, --verbose', 'Show detailed status (memory, auto-scaling, projects)')
    .action(async (cmdOpts) => {
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
      if (status.version) {
        console.log(`Version: ${status.version}`);
      }
      if (status.startTime) {
        console.log(`Started: ${formatDateTime(new Date(status.startTime))}`);
      }

      try {
        const result = await sendDaemonRequest('/status', {});
        if (result.success && result.data) {
          const d = result.data;
          console.log(`Status: ${d.status}`);
          console.log(`Uptime: ${Math.floor(d.uptime)}s`);

          // 多项目/单项目自适应展示
          if (d.projects && d.projects.length > 0) {
            const maxProjects = d.autoScaling?.maxProjects;
            const header = maxProjects
              ? `Projects (${d.projects.length}/${maxProjects}):`
              : `Projects (${d.projects.length}):`;
            console.log(header);
            for (const p of d.projects) {
              const age = Math.floor((Date.now() - p.lastAccess) / 1000);
              const ageStr = age < 60 ? `${age}s ago`
                : age < 3600 ? `${Math.floor(age / 60)}m ago`
                : `${Math.floor(age / 3600)}h ago`;
              const displayPath = p.path.length > 50 ? '...' + p.path.slice(-47) : p.path;
              console.log(`  ${displayPath.padEnd(52)} ${p.status.padEnd(12)} ${ageStr}`);
            }
          } else {
            console.log('Projects: none');
          }
          if (d.version && !status.version) {
            console.log(`Version: ${d.version}`);
          }
          if (d.startTime && !status.startTime) {
            console.log(`Started: ${formatDateTime(new Date(d.startTime))}`);
          }

          // --verbose: 完整状态
          if (cmdOpts.verbose) {
            console.log('');

            // Memory
            if (d.memory) {
              const m = d.memory;
              console.log('── Memory ──');
              console.log(`  Platform:      ${m.platform}`);
              console.log(`  Pressure:      ${m.pressureLevel}`);
              console.log(`  Source:        ${m.source}`);
              console.log(`  Snapshot Age:  ${m.snapshotAgeMs != null ? Math.floor(m.snapshotAgeMs) + 'ms' : 'N/A'}`);
              console.log(`  Stale:         ${m.snapshotStale}`);
              console.log(`  Degraded:      ${m.degraded}${m.reason ? ` (${m.reason})` : ''}`);
              console.log(`  Failures:      ${m.consecutiveFailures}`);
              if (m.snapshot) {
                const s = m.snapshot;
                console.log(`  Total MB:      ${s.totalMB}`);
                console.log(`  Free MB:       ${s.freeMB}`);
                console.log(`  Used %:        ${s.usedPercent?.toFixed(1)}%`);
                if (s.availableMB != null) console.log(`  Available MB:  ${s.availableMB}`);
                if (s.commitPercent != null) console.log(`  Commit %:      ${s.commitPercent}%`);
                if (s.swapUsedMB != null) console.log(`  Swap MB:       ${s.swapUsedMB}`);
                if (s.pageSize) console.log(`  Page Size:     ${s.pageSize}`);
                if (s.collectionDurationMs) console.log(`  Collect Time:  ${s.collectionDurationMs}ms`);
              }
              console.log('');
            }

            // Auto-scaling
            if (d.autoScaling) {
              const a = d.autoScaling;
              console.log('── Auto-Scaling ──');
              console.log(`  Enabled:       ${a.enabled}`);
              console.log(`  Degraded:      ${a.degraded}`);
              console.log(`  Projects:      ${a.currentProjectCount} / ${a.capacity} (max ${a.maxProjects})`);
              if (a.lastScaleAction) {
                console.log(`  Last Action:   ${a.lastScaleAction.action} — ${a.lastScaleAction.reason}`);
                if (a.lastScaleAction.targetProject) {
                  console.log(`  Target:        ${a.lastScaleAction.targetProject}`);
                }
              }
              if (a.lastScaleTime) {
                const age = Math.floor((Date.now() - a.lastScaleTime) / 1000);
                console.log(`  Last Scale:    ${age}s ago`);
              }
              console.log('');
            }

            // Projects detail
            if (d.projects && d.projects.length > 0) {
              console.log('── Projects ──');
              for (const p of d.projects) {
                const age = Math.floor((Date.now() - p.lastAccess) / 1000);
                const idx = p.indexProgress;
                console.log(`  ${p.path}`);
                console.log(`    Status:     ${p.status}  Priority: ${p.priority}  Idle: ${age}s`);
                if (p.loadTime) console.log(`    Load Time:  ${p.loadTime}ms`);
                if (idx) console.log(`    Index:      ${idx.stage}${idx.percent != null ? ' (' + idx.percent + '%)' : ''}${idx.title ? ' — ' + idx.title : ''}`);
                if (p.processMemory && p.processMemory.rssMB >= 0) {
                  console.log(`    RSS:        ${p.processMemory.rssMB} MB  (PID ${p.processMemory.pid})`);
                }
              }
              console.log('');
            }

            // Warnings
            if (d.warnings && d.warnings.length > 0) {
              console.log('── Warnings ──');
              for (const w of d.warnings) {
                console.log(`  ⚠ ${w}`);
              }
              console.log('');
            }

            // Library resolve
            console.log(`Library Resolve: ${d.libraryResolveEnabled ? 'enabled' : 'disabled'}`);
          }
        }
      } catch (e) {
        // ignore
      }
    });

  // daemon memory
  daemonCmd
    .command('memory')
    .description('显示当前内存快照和压力级别。')
    .configureHelp({ formatHelp: () => MEMORY_HELP })
    .action(async () => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Daemon is not running');
        process.exit(1);
      }

      try {
        const result = await sendDaemonRequest('/status', {});
        if (result.success && result.data?.memory) {
          const m = result.data.memory;
          console.log('── System Memory ──');
          console.log(`Platform:      ${m.platform}`);
          console.log(`Pressure:      ${m.pressureLevel}`);
          console.log(`Source:        ${m.source}`);
          console.log(`Degraded:      ${m.degraded}${m.reason ? ` (${m.reason})` : ''}`);
          console.log(`Snapshot Age:  ${m.snapshotAgeMs != null ? Math.floor(m.snapshotAgeMs) + 'ms' : 'N/A'}`);
          console.log(`Stale:         ${m.snapshotStale}`);
          console.log(`Failures:      ${m.consecutiveFailures}`);

          if (m.snapshot) {
            const s = m.snapshot;
            console.log('');
            console.log('── Snapshot ──');
            console.log(`Total MB:      ${s.totalMB}`);
            console.log(`Free MB:       ${s.freeMB}`);
            console.log(`Used:          ${s.usedPercent?.toFixed(1)}%`);
            if (s.availableMB != null) console.log(`Available MB:  ${s.availableMB}`);
            if (s.commitPercent != null) console.log(`Commit %:      ${s.commitPercent}%`);
            if (s.memoryPressureFreePercent != null) console.log(`Free %:        ${s.memoryPressureFreePercent}%`);
            if (s.swapUsedMB != null) console.log(`Swap MB:       ${s.swapUsedMB}`);
            if (s.pageSize) console.log(`Page Size:     ${s.pageSize}`);
            if (s.collectionDurationMs) console.log(`Collect Time:  ${s.collectionDurationMs}ms`);
          }

          // Also show per-project RSS if available
          if (result.data.projects && result.data.projects.length > 0) {
            console.log('');
            console.log('── Project RSS ──');
            for (const p of result.data.projects) {
              if (p.processMemory && p.processMemory.rssMB >= 0) {
                console.log(`  ${p.processMemory.rssMB} MB  — ${p.path}  (PID ${p.processMemory.pid})`);
              } else {
                console.log(`  N/A  — ${p.path}`);
              }
            }
          }
        } else if (result.success && !result.data?.memory) {
          console.log('Memory monitoring not available (single-project mode or auto-scaling disabled)');
        } else {
          console.log('Failed to get memory info');
          process.exit(1);
        }
      } catch (e) {
        console.error('Failed to get memory info');
        process.exit(1);
      }
    });

  // daemon list
  daemonCmd
    .command('list')
    .description('列出所有已加载的项目。')
    .configureHelp({ formatHelp: () => LIST_HELP })
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
    .description('释放已加载项目（释放内存）。')
    .configureHelp({ formatHelp: () => RELEASE_HELP })
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

  // daemon stop-project
  daemonCmd
    .command('stop-project <projectPath>')
    .description('优雅停止一个已加载项目。')
    .configureHelp({ formatHelp: () => STOP_PROJECT_HELP })
    .option('--force', 'Skip draining and force stop immediately')
    .action(async (projectPath: string, cmdOpts) => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Daemon is not running');
        process.exit(1);
      }

      try {
        const result = await sendDaemonRequest('/stop-project', {
          project: projectPath,
          force: cmdOpts.force || false,
        });
        if (result.success) {
          console.log(`Project stopped: ${result.data?.project || projectPath}`);
        } else {
          console.error(`Failed to stop project: ${result.error}`);
          process.exit(1);
        }
      } catch (e) {
        console.error('Failed to stop project');
        process.exit(1);
      }
    });

  // daemon config（热更新自动伸缩等运行时配置，设计 3.6）
  daemonCmd
    .command('config')
    .description('热更新运行时配置。')
    .configureHelp({ formatHelp: () => DAEMON_CONFIG_HELP })
    .option('--auto-scaling <key=value>', 'Set auto-scaling config (e.g. enabled=false)')
    .option('--key <key>', 'Arbitrary config key (supports dot-notation)')
    .option('--value <value>', 'Config value for --key')
    .action(async (cmdOpts) => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Daemon is not running');
        process.exit(1);
      }

      try {
        let key: string | undefined;
        let value: unknown;

        if (cmdOpts.autoScaling) {
          // --auto-scaling enabled=false → key=autoScaling.enabled, value=false
          const match = cmdOpts.autoScaling.match(/^(\w+)=(.+)$/);
          if (!match) {
            console.error(`Invalid --auto-scaling format: "${cmdOpts.autoScaling}"`);
            console.error('Expected: <key>=<value> (e.g. enabled=false)');
            process.exit(1);
          }
          key = `autoScaling.${match[1]}`;
          value = parseConfigValue(match[2]);
        } else if (cmdOpts.key) {
          key = cmdOpts.key;
          value = parseConfigValue(cmdOpts.value ?? '');
        } else {
          console.error('No config option specified. Use --auto-scaling or --key/--value.');
          console.error('Examples:');
          console.error('  jls daemon config --auto-scaling enabled=false');
          console.error('  jls daemon config --key cacheTtlDays --value 14');
          process.exit(1);
        }

        const result = await sendDaemonRequest('/config', { key, value });
        if (result.success) {
          console.log(`Config updated: ${key} = ${JSON.stringify(value)}`);
          if (result.data?.updated) {
            const autoScaling = result.data.updated.autoScaling;
            if (autoScaling) {
              console.log('Auto-scaling runtime config:', JSON.stringify(autoScaling));
            }
          }
        } else {
          console.error('Failed to update config:', (result as any).error);
          process.exit(1);
        }
      } catch (e: any) {
        console.error('Failed to update config:', e?.message || e);
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
