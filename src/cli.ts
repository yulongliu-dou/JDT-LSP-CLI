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
import { CLIResult, SymbolInfo, COMPACT_FIELDS } from './types';
import { startDaemon, getDaemonStatus, stopDaemon, DAEMON_PORT } from './daemon';
import { resolveSymbol, buildSymbolQuery, isSymbolMode, SymbolResolveResult, CommandType, matchSignature } from './symbolResolver';

const program = new Command();

// 全局选项
program
  .name('jls')
  .description('Java LSP CLI - Fast Java language features for AI agents (with daemon support)')
  .version('1.6.4')
  .option('-p, --project <path>', 'Java project root directory', process.cwd())
  .option('--jdtls-path <path>', 'Path to eclipse.jdt.ls server')
  .option('--data-dir <path>', 'JDT LS data directory')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--timeout <ms>', 'Operation timeout in milliseconds', '60000')
  .option('--no-daemon', 'Disable daemon mode, start JDT LS for each command (slower)')
  .option('--json-compact', 'Output compact JSON (minimal fields)', false);

/**
 * 紧凑化数据对象（只保留指定字段）
 * 
 * 支持两种数据结构：
 * 1. 直接数组: [...] - 对数组元素进行字段提取
 * 2. 包装对象: { field: [...], count: N } - 对内部数组进行字段提取，保留包装结构
 */
function compactData(data: any, command: string): any {
  const fields = (COMPACT_FIELDS as any)[command];
  if (!fields || !data) return data;
  
  // 处理数组（直接返回数组的情况）
  if (Array.isArray(data)) {
    return data.map(item => compactItem(item, fields));
  }
  
  // 处理对象 - 检查是否是包装对象结构
  if (typeof data === 'object' && data !== null) {
    // 定义命令到数组字段的映射（包装对象中的数组字段名）
    const arrayFieldMap: Record<string, string> = {
      'symbols': 'symbols',
      'sym': 'symbols',
      'references': 'references',
      'refs': 'references',
      'implementations': 'implementations',
      'impl': 'implementations',
      'workspaceSymbols': 'symbols',
      'find': 'symbols',
      'f': 'symbols',
    };
    
    const arrayField = arrayFieldMap[command];
    
    // 如果是包装对象结构，对内部数组进行紧凑化
    if (arrayField && Array.isArray(data[arrayField])) {
      return {
        ...data,
        [arrayField]: data[arrayField].map((item: any) => compactItem(item, fields))
      };
    }
    
    // 否则对整个对象进行字段提取
    return compactItem(data, fields);
  }
  
  return data;
}

function compactItem(item: any, fields: string[]): any {
  if (!item || typeof item !== 'object') return item;
  
  const result: any = {};
  for (const field of fields) {
    const value = getNestedValue(item, field);
    if (value !== undefined) {
      setNestedValue(result, field, value);
    }
  }
  return result;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let curr = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!curr[keys[i]]) curr[keys[i]] = {};
    curr = curr[keys[i]];
  }
  curr[keys[keys.length - 1]] = value;
}

/**
 * 输出 JSON 结果（支持紧凑模式）
 */
function outputResult<T>(result: CLIResult<T>, command?: string, compact?: boolean): void {
  let output = result;
  if (compact && result.data && command) {
    output = { ...result, data: compactData(result.data, command) as T };
  }
  console.log(JSON.stringify(output, compact ? null : null, compact ? 0 : 2));
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
 * 通过符号名称解析位置
 * @returns 成功返回 { line, col }，失败返回错误结果
 */
async function resolvePositionBySymbol(
  filePath: string,
  projectPath: string,
  cmdOptions: any,
  opts: any
): Promise<{ line: string; col: string } | CLIResult<any>> {
  // 符号解析需要先获取文档符号
  const symbolQuery = buildSymbolQuery(cmdOptions);
  if (!symbolQuery) {
    return {
      success: false,
      error: 'Symbol query requires --method or --symbol option',
      elapsed: 0,
    };
  }

  // 获取文档符号
  let symbols: SymbolInfo[];
  
  if (opts.daemon !== false) {
    // 尝试通过守护进程获取
    const symbolsResult = await sendDaemonRequest('/symbols', {
      project: projectPath,
      file: filePath,
      options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
    });
    
    if (!symbolsResult.success) {
      // 守护进程不可用，回退到直接模式
      let client: JdtLsClient | null = null;
      try {
        client = await createDirectClient(opts);
        symbols = await client.getDocumentSymbols(filePath);
      } catch (error: any) {
        return {
          success: false,
          error: `Failed to get document symbols: ${error.message}`,
          elapsed: 0,
        };
      } finally {
        if (client) await client.stop();
      }
    } else {
      symbols = symbolsResult.data?.symbols || [];
    }
  } else {
    // 直接模式
    let client: JdtLsClient | null = null;
    try {
      client = await createDirectClient(opts);
      symbols = await client.getDocumentSymbols(filePath);
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to get document symbols: ${error.message}`,
        elapsed: 0,
      };
    } finally {
      if (client) await client.stop();
    }
  }

  // 解析符号位置
  const result = resolveSymbol(symbols, symbolQuery);
  
  if (!result.success) {
    return {
      success: false,
      error: result.error.message,
      data: { resolution_error: result.error },
      elapsed: 0,
    };
  }

  return {
    line: String(result.position.line),
    col: String(result.position.character),
  };
}

/**
 * 通过 workspace/symbol 全局解析方法位置
 */
async function resolveGlobalPosition(
  methodName: string,
  projectPath: string,
  cmdOptions: any,
  opts: any
): Promise<{ filePath: string; line: string; col: string } | CLIResult<any>> {
  // Step 1: 使用 workspace/symbol 搜索方法
  let symbols: any[];
  
  if (opts.daemon !== false) {
    const result = await sendDaemonRequest('/workspace-symbols', {
      project: projectPath,
      query: methodName,
      kind: cmdOptions.kind || 'Method',
      limit: 20,
      options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
    });
    
    if (!result.success) {
      // 回退到直接模式
      let client: JdtLsClient | null = null;
      try {
        client = await createDirectClient(opts);
        symbols = await client.getWorkspaceSymbols(methodName, 20);
      } catch (error: any) {
        return {
          success: false,
          error: `Failed to search workspace symbols: ${error.message}`,
          elapsed: 0,
        };
      } finally {
        if (client) await client.stop();
      }
    } else {
      symbols = result.data?.symbols || [];
    }
  } else {
    let client: JdtLsClient | null = null;
    try {
      client = await createDirectClient(opts);
      symbols = await client.getWorkspaceSymbols(methodName, 20);
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to search workspace symbols: ${error.message}`,
        elapsed: 0,
      };
    } finally {
      if (client) await client.stop();
    }
  }
  
  // 过滤符号类型（如果指定）
  const kindFilter = (cmdOptions.kind || 'Method').toLowerCase();
  
  // 先按 kind 过滤，然后精确匹配名称
  const sameKindSymbols = symbols.filter((s: any) => 
    s.kind?.toLowerCase() === kindFilter
  );
  
  // 精确匹配名称
  let filtered = sameKindSymbols.filter((s: any) => 
    s.name === methodName
  );
  
  // 如果没有精确匹配，尝试不区分大小写的精确匹配
  if (filtered.length === 0) {
    filtered = sameKindSymbols.filter((s: any) => 
      s.name?.toLowerCase() === methodName.toLowerCase()
    );
  }
  
  // 如果提供了签名，按签名过滤（用于区分重载方法）
  if (cmdOptions.signature && filtered.length > 0) {
    const signatureFiltered = filtered.filter((s: any) => 
      matchSignature(s.containerName || s.detail, cmdOptions.signature)
    );
    
    // 如果签名过滤后有结果，使用过滤后的结果
    // 如果没有匹配，保留原结果并给出警告
    if (signatureFiltered.length > 0) {
      filtered = signatureFiltered;
    } else {
      return {
        success: false,
        error: `Found ${filtered.length} matches for '${methodName}', but none match signature '${cmdOptions.signature}'`,
        data: {
          candidates: filtered.map((s: any, idx: number) => ({
            index: idx,
            name: s.name,
            kind: s.kind,
            container: s.containerName,
            detail: s.detail,
            file: s.location?.uri?.replace('file://', ''),
            line: (s.location?.range?.start?.line || 0) + 1,
          }))
        },
        elapsed: 0,
      };
    }
  }
  
  if (filtered.length === 0) {
    return {
      success: false,
      error: `No ${kindFilter} named '${methodName}' found in workspace`,
      data: {
        suggestions: symbols.slice(0, 10).map((s: any) => `${s.name} [${s.kind}] in ${s.containerName || 'unknown'}`)
      },
      elapsed: 0,
    };
  }
  
  // 如果有多个匹配且未指定索引，返回歧义
  if (filtered.length > 1 && cmdOptions.index === undefined) {
    return {
      success: false,
      error: `Found ${filtered.length} matches for '${methodName}'. Use --index to select.`,
      data: {
        candidates: filtered.map((s: any, idx: number) => ({
          index: idx,
          name: s.name,
          kind: s.kind,
          container: s.containerName,
          file: s.location?.uri?.replace('file://', ''),
          line: (s.location?.range?.start?.line || 0) + 1,
        }))
      },
      elapsed: 0,
    };
  }
  
  // 选择符号
  const selectedIdx = cmdOptions.index !== undefined ? parseInt(cmdOptions.index) : 0;
  const selected = filtered[selectedIdx];
  
  if (!selected) {
    return {
      success: false,
      error: `Index ${selectedIdx} out of range. Found ${filtered.length} matches.`,
      elapsed: 0,
    };
  }
  
  // 提取位置
  const uri = selected.location?.uri || '';
  const filePath = uri.replace('file://', '').replace(/^\/([A-Za-z]:)/, '$1'); // Windows 路径修复
  const line = (selected.location?.range?.start?.line || 0) + 1;
  const col = (selected.location?.range?.start?.character || 0) + 1;
  
  return {
    filePath,
    line: String(line),
    col: String(col),
  };
}

/**
 * 检查是否使用符号模式，并解析位置（支持全局定位）
 */
async function getPosition(
  file: string | undefined,
  line: string | undefined,
  col: string | undefined,
  cmdOptions: any,
  opts: any
): Promise<{ filePath: string; line: string; col: string } | CLIResult<any>> {
  const projectPath = path.resolve(opts.project);
  
  // 全局定位模式：不需要文件路径
  if (cmdOptions.global && isSymbolMode(cmdOptions)) {
    const methodName = cmdOptions.method || cmdOptions.symbol;
    return await resolveGlobalPosition(methodName, projectPath, cmdOptions, opts);
  }
  
  // 检查文件参数
  if (!file) {
    if (isSymbolMode(cmdOptions)) {
      return {
        success: false,
        error: 'File path is required. Use --global for workspace-wide search without file path.',
        elapsed: 0,
      };
    }
    return {
      success: false,
      error: 'Missing required arguments. Usage:\n' +
             '  jls <command> <file> <line> <col>\n' +
             '  jls <command> <file> --method <name>\n' +
             '  jls <command> <file> --symbol <name>\n' +
             '  jls <command> --global --symbol <name> --kind <type>\n' +
             '\nUse --help for more information.',
      elapsed: 0,
    };
  }
  
  const filePath = resolveFilePath(file, projectPath);
  
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: `File not found: ${filePath}`,
      elapsed: 0,
    };
  }
  
  // 检查是否使用符号模式
  if (isSymbolMode(cmdOptions)) {
    const result = await resolvePositionBySymbol(filePath, projectPath, cmdOptions, opts);
    if ('success' in result) {
      return result; // 错误结果
    }
    return { filePath, line: result.line, col: result.col };
  }
  
  // 传统模式：使用行列参数
  if (!line || !col) {
    return {
      success: false,
      error: 'Position required: either provide <line> <col> or use --method/--symbol option',
      elapsed: 0,
    };
  }
  
  return { filePath, line, col };
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
  opts: any,
  commandName?: string
): Promise<void> {
  const startTime = Date.now();
  const compact = opts.jsonCompact;
  
  // 如果禁用了守护进程，使用直接模式
  if (opts.daemon === false) {
    try {
      const result = await directHandler();
      outputResult({
        success: true,
        data: result,
        elapsed: Date.now() - startTime,
      }, commandName, compact);
    } catch (error: any) {
      outputResult({
        success: false,
        error: error.message,
        elapsed: Date.now() - startTime,
      }, commandName, compact);
    }
    return;
  }
  
  // 尝试守护进程模式
  const daemonResult = await sendDaemonRequest(endpoint, body);
  
  if (daemonResult.success || !daemonResult.error?.includes('Daemon not running')) {
    outputResult(daemonResult, commandName, compact);
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
    }, commandName, compact);
  } catch (error: any) {
    outputResult({
      success: false,
      error: error.message,
      elapsed: Date.now() - startTime,
    }, commandName, compact);
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
  .option('--eager', 'Pre-initialize project immediately (eliminates lazy loading delay)')
  .option('--init-project <path>', 'Project path to pre-initialize with --eager')
  .action((cmdOpts) => {
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
    
    startDaemon(parseInt(cmdOpts.port), eagerOptions);
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

daemonCmd
  .command('list')
  .description('List all loaded projects (multi-project mode)')
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

daemonCmd
  .command('release [project]')
  .description('Release a loaded project (free memory)')
  .action(async (project: string | undefined) => {
    const opts = program.opts();
    const status = getDaemonStatus();
    if (!status.running) {
      console.log('Daemon is not running');
      process.exit(1);
    }
    
    const targetProject = project || opts.project;
    
    try {
      const result = await sendDaemonRequest('/release', {
        project: targetProject,
        releaseProject: targetProject,
      });
      if (result.success && result.data?.released) {
        console.log(`Project released: ${targetProject}`);
      } else {
        console.log(`Failed to release project: ${result.data?.reason || 'unknown'}`);
      }
    } catch (e) {
      console.error('Failed to release project');
    }
  });

// ========== LSP 命令 ==========

// 符号定位通用选项
const symbolOptions = [
  { flags: '--method <name>', desc: 'Method name to locate (auto-resolve position)' },
  { flags: '--symbol <name>', desc: 'Symbol name to locate (auto-resolve position)' },
  { flags: '--container <path>', desc: 'Parent container path, e.g., "MyClass.myMethod"' },
  { flags: '--signature <sig>', desc: 'Method signature for overloads, e.g., "(String, int)"' },
  { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
  { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
  { flags: '--global', desc: '⚠️ Global search (requires --symbol AND --kind, JDT LS limitation)' },
];

/**
 * 为命令添加符号定位选项
 */
function addSymbolOptions(cmd: any): any {
  for (const opt of symbolOptions) {
    cmd = cmd.option(opt.flags, opt.desc);
  }
  return cmd;
}

// call-hierarchy
let callHierarchyCmd = program
  .command('call-hierarchy [file] [line] [col]')
  .alias('ch')
  .description('Get call hierarchy for a method. Use --method for auto-positioning.')
  .option('-d, --depth <n>', 'Maximum recursion depth', '5')
  .option('--incoming', 'Get incoming calls instead of outgoing', false);
callHierarchyCmd = addSymbolOptions(callHierarchyCmd);
callHierarchyCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    await executeCommand(
      '/call-hierarchy',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        depth: cmdOptions.depth,
        incoming: cmdOptions.incoming,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const items = await client.prepareCallHierarchy(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
          
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
      opts,
      'callHierarchy'
    );
  });

// definition
let definitionCmd = program
  .command('definition [file] [line] [col]')
  .alias('def')
  .description('Go to definition of a symbol. Use --symbol for auto-positioning.');
definitionCmd = addSymbolOptions(definitionCmd);
definitionCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    await executeCommand(
      '/definition',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          return await client.getDefinition(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'definition'
    );
  });

// references
let referencesCmd = program
  .command('references [file] [line] [col]')
  .alias('refs')
  .description('Find all references to a symbol. Use --symbol for auto-positioning.')
  .option('--no-declaration', 'Exclude the declaration itself');
referencesCmd = addSymbolOptions(referencesCmd);
referencesCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    await executeCommand(
      '/references',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        includeDeclaration: cmdOptions.declaration !== false,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const result = await client.getReferences(filePath, parseInt(resolvedLine), parseInt(resolvedCol), cmdOptions.declaration !== false);
          return { references: result, count: result.length };
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'references'
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
      opts,
      'symbols'
    );
  });

// find (workspace/symbol)
program
  .command('find <query>')
  .alias('f')
  .description('Search symbols across the entire workspace')
  .option('--kind <type>', 'Filter by symbol kind: Class, Method, Field, Interface...')
  .option('--limit <n>', 'Maximum number of results', '50')
  .action(async (query: string, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    await executeCommand(
      '/workspace-symbols',
      {
        project: projectPath,
        query,
        kind: cmdOptions.kind,
        limit: cmdOptions.limit,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          let symbols = await client.getWorkspaceSymbols(query, parseInt(cmdOptions.limit));
          
          // 按 kind 过滤
          if (cmdOptions.kind) {
            const kindFilter = cmdOptions.kind.toLowerCase();
            symbols = symbols.filter((s: any) => 
              s.kind.toLowerCase() === kindFilter
            );
          }
          
          return { symbols, count: symbols.length };
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'workspaceSymbols'
    );
  });

// type-definition
let typeDefCmd = program
  .command('type-definition [file] [line] [col]')
  .alias('typedef')
  .description('Go to type definition (e.g., variable type -> class). Use --symbol for auto-positioning.');
typeDefCmd = addSymbolOptions(typeDefCmd);
typeDefCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    await executeCommand(
      '/type-definition',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          return await client.getTypeDefinition(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'typeDefinition'
    );
  });

// implementations
let implementationsCmd = program
  .command('implementations [file] [line] [col]')
  .alias('impl')
  .description('Find implementations. Use --symbol for auto-positioning.');
implementationsCmd = addSymbolOptions(implementationsCmd);
implementationsCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    await executeCommand(
      '/implementations',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const result = await client.getImplementations(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
          return { implementations: result, count: result.length };
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'implementations'
    );
  });

// hover
let hoverCmd = program
  .command('hover [file] [line] [col]')
  .description('Get hover information. Use --symbol for auto-positioning.');
hoverCmd = addSymbolOptions(hoverCmd);
hoverCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    
    await executeCommand(
      '/hover',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          return await client.getHover(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'hover'
    );
  });

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供命令，显示帮助
if (process.argv.length <= 2) {
  program.help();
}
