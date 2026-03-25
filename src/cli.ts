#!/usr/bin/env node
/**
 * JDT LSP CLI - 命令行入口
 * 
 * 支持两种运行模式：
 * 1. 守护进程模式（默认）：通过 HTTP 与常驻的 JDT LS 进程通信，响应快
 * 2. 直接模式（--no-daemon）：每次命令启动新的 JDT LS 进程，响应慢但无需管理守护进程
 * 
 * 守护进程管理:
 *   jls daemon start   - 启动守护进程
 *   jls daemon stop    - 停止守护进程
 *   jls daemon status  - 查看守护进程状态
 * 
 * LSP 命令:
 *   jls call-hierarchy <file> <line> <col>
 *   jls definition <file> <line> <col>
 *   jls references <file> <line> <col>
 *   jls symbols <file>
 *   jls implementations <file> <line> <col>
 *   jls hover <file> <line> <col>
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { JdtLsClient, loadConfig, generateConfigTemplate, CONFIG_FILE, DEFAULT_JVM_CONFIG } from './jdtClient';
import { CLIResult } from './types';
import { startDaemon, getDaemonStatus, stopDaemon, DAEMON_PORT } from './daemon';

const program = new Command();

// 全局选项
program
  .name('jls')
  .description('Java LSP CLI - Fast Java language features for AI agents (with daemon support)')
  .version('1.2.0')
  .option('-p, --project <path>', 'Java project root directory', process.cwd())
  .option('--jdtls-path <path>', 'Path to eclipse.jdt.ls server')
  .option('--data-dir <path>', 'JDT LS data directory')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--timeout <ms>', 'Operation timeout in milliseconds', '60000')
  .option('--no-daemon', 'Disable daemon mode, start JDT LS for each command (slower)');

/**
 * 输出 JSON 结果
 */
function outputResult<T>(result: CLIResult<T>): void {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

/**
 * 解析文件路径（确保是绝对路径）
 */
function resolveFilePath(filePath: string, projectPath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectPath, filePath);
}

/**
 * 通过守护进程发送请求
 */
async function sendDaemonRequest(endpoint: string, body: any): Promise<CLIResult<any>> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: DAEMON_PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 120000,
    }, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve({
            success: false,
            error: `Invalid response from daemon: ${responseData}`,
            elapsed: 0,
          });
        }
      });
    });
    
    req.on('error', (e: any) => {
      if (e.code === 'ECONNREFUSED') {
        resolve({
          success: false,
          error: 'Daemon not running. Start it with: jls daemon start',
          elapsed: 0,
        });
      } else {
        resolve({
          success: false,
          error: `Daemon connection error: ${e.message}`,
          elapsed: 0,
        });
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Daemon request timeout',
        elapsed: 0,
      });
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * 创建直接模式客户端
 */
async function createDirectClient(options: any): Promise<JdtLsClient> {
  const client = new JdtLsClient({
    projectPath: path.resolve(options.project),
    jdtlsPath: options.jdtlsPath,
    dataDir: options.dataDir,
    timeout: parseInt(options.timeout, 10),
    verbose: options.verbose,
  });

  await client.start();
  return client;
}

/**
 * 执行命令（自动选择守护进程或直接模式）
 */
async function executeCommand(
  endpoint: string,
  body: any,
  directHandler: () => Promise<any>,
  opts: any
): Promise<void> {
  const startTime = Date.now();
  
  // 如果禁用了守护进程，使用直接模式
  if (opts.daemon === false) {
    try {
      const result = await directHandler();
      outputResult({
        success: true,
        data: result,
        elapsed: Date.now() - startTime,
      });
    } catch (error: any) {
      outputResult({
        success: false,
        error: error.message,
        elapsed: Date.now() - startTime,
      });
    }
    return;
  }
  
  // 尝试守护进程模式
  const daemonResult = await sendDaemonRequest(endpoint, body);
  
  if (daemonResult.success || !daemonResult.error?.includes('Daemon not running')) {
    outputResult(daemonResult);
    return;
  }
  
  // 守护进程未运行，提示用户启动或使用直接模式
  console.error('Daemon not running. Options:');
  console.error('  1. Start daemon: jls daemon start');
  console.error('  2. Use direct mode: jls --no-daemon <command> (slower)');
  console.error('');
  console.error('Starting in direct mode...');
  
  try {
    const result = await directHandler();
    outputResult({
      success: true,
      data: result,
      elapsed: Date.now() - startTime,
    });
  } catch (error: any) {
    outputResult({
      success: false,
      error: error.message,
      elapsed: Date.now() - startTime,
    });
  }
}

// ========== 守护进程管理命令 ==========
const daemonCmd = program
  .command('daemon')
  .description('Manage the JDT LSP daemon process');

daemonCmd
  .command('start')
  .description('Start the daemon process')
  .option('--port <port>', 'Daemon port', String(DAEMON_PORT))
  .action((cmdOpts) => {
    const status = getDaemonStatus();
    if (status.running) {
      console.log(`Daemon already running with PID ${status.pid}`);
      process.exit(0);
    }
    
    console.log('Starting JDT LSP daemon...');
    startDaemon(parseInt(cmdOpts.port));
  });

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

// ========== 配置文件管理命令 ==========
const configCmd = program
  .command('config')
  .description('Manage JDT LSP CLI configuration');

configCmd
  .command('init')
  .description('Create default configuration file')
  .option('-f, --force', 'Overwrite existing config file')
  .action((cmdOpts) => {
    if (fs.existsSync(CONFIG_FILE) && !cmdOpts.force) {
      console.log(`Config file already exists: ${CONFIG_FILE}`);
      console.log('Use --force to overwrite');
      process.exit(1);
    }
    generateConfigTemplate();
    console.log('You can now edit the config file to customize JVM parameters.');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log(`Config file: ${CONFIG_FILE}`);
    console.log(`File exists: ${fs.existsSync(CONFIG_FILE)}`);
    console.log('');
    console.log('Current configuration:');
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command('path')
  .description('Show configuration file path')
  .action(() => {
    console.log(CONFIG_FILE);
  });

configCmd
  .command('defaults')
  .description('Show default JVM configuration')
  .action(() => {
    console.log('Default JVM configuration:');
    console.log(JSON.stringify(DEFAULT_JVM_CONFIG, null, 2));
  });

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
    
    // 获取详细状态
    try {
      const result = await sendDaemonRequest('/status', {});
      if (result.success && result.data) {
        console.log(`Project: ${result.data.project || 'none'}`);
        console.log(`Status: ${result.data.status}`);
        console.log(`Uptime: ${Math.floor(result.data.uptime)}s`);
      }
    } catch (e) {
      // ignore
    }
  });

// ========== LSP 命令 ==========

// call-hierarchy
program
  .command('call-hierarchy <file> <line> <col>')
  .alias('ch')
  .description('Get call hierarchy for a method')
  .option('-d, --depth <n>', 'Maximum recursion depth', '5')
  .option('--incoming', 'Get incoming calls instead of outgoing', false)
  .action(async (file: string, line: string, col: string, cmdOptions: any) => {
    const opts = program.opts();
    const filePath = resolveFilePath(file, opts.project);
    const projectPath = path.resolve(opts.project);
    
    if (!fs.existsSync(filePath)) {
      outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 });
      return;
    }
    
    await executeCommand(
      '/call-hierarchy',
      {
        project: projectPath,
        file: filePath,
        line,
        col,
        depth: cmdOptions.depth,
        incoming: cmdOptions.incoming,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const items = await client.prepareCallHierarchy(filePath, parseInt(line), parseInt(col));
          
          if (!items || items.length === 0) {
            return { entry: null, calls: [], totalMethods: 0 };
          }
          
          const maxDepth = parseInt(cmdOptions.depth, 10);
          const visited = new Set<string>();
          const allCalls: any[] = [];
          
          async function collectCalls(item: any, depth: number): Promise<void> {
            const key = `${item.uri}#${item.name}#${item.range?.start?.line}`;
            if (visited.has(key) || depth > maxDepth) return;
            visited.add(key);
            
            const calls = cmdOptions.incoming
              ? await client!.getIncomingCalls(item)
              : await client!.getOutgoingCalls(item);
            
            for (const call of calls) {
              const target = cmdOptions.incoming ? call.from : call.to;
              if (!target.uri.includes('jdt://')) {
                allCalls.push({
                  depth,
                  caller: cmdOptions.incoming ? target.name : item.name,
                  callee: cmdOptions.incoming ? item.name : target.name,
                  location: { uri: target.uri, range: target.range },
                  kind: target.kind,
                });
                await collectCalls(target, depth + 1);
              }
            }
          }
          
          await collectCalls(items[0], 0);
          
          return {
            entry: { name: items[0].name, kind: items[0].kind, detail: items[0].detail, uri: items[0].uri, range: items[0].range },
            calls: allCalls,
            totalMethods: visited.size,
          };
        } finally {
          if (client) await client.stop();
        }
      },
      opts
    );
  });

// definition
program
  .command('definition <file> <line> <col>')
  .alias('def')
  .description('Go to definition of a symbol')
  .action(async (file: string, line: string, col: string) => {
    const opts = program.opts();
    const filePath = resolveFilePath(file, opts.project);
    const projectPath = path.resolve(opts.project);
    
    if (!fs.existsSync(filePath)) {
      outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 });
      return;
    }
    
    await executeCommand(
      '/definition',
      {
        project: projectPath,
        file: filePath,
        line,
        col,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          return await client.getDefinition(filePath, parseInt(line), parseInt(col));
        } finally {
          if (client) await client.stop();
        }
      },
      opts
    );
  });

// references
program
  .command('references <file> <line> <col>')
  .alias('refs')
  .description('Find all references to a symbol')
  .option('--no-declaration', 'Exclude the declaration itself')
  .action(async (file: string, line: string, col: string, cmdOptions: any) => {
    const opts = program.opts();
    const filePath = resolveFilePath(file, opts.project);
    const projectPath = path.resolve(opts.project);
    
    if (!fs.existsSync(filePath)) {
      outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 });
      return;
    }
    
    await executeCommand(
      '/references',
      {
        project: projectPath,
        file: filePath,
        line,
        col,
        includeDeclaration: cmdOptions.declaration !== false,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const result = await client.getReferences(filePath, parseInt(line), parseInt(col), cmdOptions.declaration !== false);
          return { references: result, count: result.length };
        } finally {
          if (client) await client.stop();
        }
      },
      opts
    );
  });

// symbols
program
  .command('symbols <file>')
  .alias('sym')
  .description('Get document symbols')
  .option('--flat', 'Flatten the symbol hierarchy')
  .action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();
    const filePath = resolveFilePath(file, opts.project);
    const projectPath = path.resolve(opts.project);
    
    if (!fs.existsSync(filePath)) {
      outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 });
      return;
    }
    
    await executeCommand(
      '/symbols',
      {
        project: projectPath,
        file: filePath,
        flat: cmdOptions.flat,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          let result = await client.getDocumentSymbols(filePath);
          
          if (cmdOptions.flat) {
            const flatList: any[] = [];
            function flatten(symbols: any[], parent?: string) {
              for (const sym of symbols) {
                flatList.push({ name: sym.name, kind: sym.kind, detail: sym.detail, range: sym.range, parent });
                if (sym.children) flatten(sym.children, sym.name);
              }
            }
            flatten(result);
            result = flatList;
          }
          
          return { symbols: result, count: cmdOptions.flat ? result.length : undefined };
        } finally {
          if (client) await client.stop();
        }
      },
      opts
    );
  });

// implementations
program
  .command('implementations <file> <line> <col>')
  .alias('impl')
  .description('Find implementations')
  .action(async (file: string, line: string, col: string) => {
    const opts = program.opts();
    const filePath = resolveFilePath(file, opts.project);
    const projectPath = path.resolve(opts.project);
    
    if (!fs.existsSync(filePath)) {
      outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 });
      return;
    }
    
    await executeCommand(
      '/implementations',
      {
        project: projectPath,
        file: filePath,
        line,
        col,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const result = await client.getImplementations(filePath, parseInt(line), parseInt(col));
          return { implementations: result, count: result.length };
        } finally {
          if (client) await client.stop();
        }
      },
      opts
    );
  });

// hover
program
  .command('hover <file> <line> <col>')
  .description('Get hover information')
  .action(async (file: string, line: string, col: string) => {
    const opts = program.opts();
    const filePath = resolveFilePath(file, opts.project);
    const projectPath = path.resolve(opts.project);
    
    if (!fs.existsSync(filePath)) {
      outputResult({ success: false, error: `File not found: ${filePath}`, elapsed: 0 });
      return;
    }
    
    await executeCommand(
      '/hover',
      {
        project: projectPath,
        file: filePath,
        line,
        col,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          return await client.getHover(filePath, parseInt(line), parseInt(col));
        } finally {
          if (client) await client.stop();
        }
      },
      opts
    );
  });

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供命令，显示帮助
if (process.argv.length <= 2) {
  program.help();
}
