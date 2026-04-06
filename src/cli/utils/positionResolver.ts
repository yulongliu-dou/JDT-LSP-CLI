/**
 * 位置解析工具
 */

import * as fs from 'fs';
import * as path from 'path';
import { JdtLsClient } from '../../jdtClient';
import { SymbolInfo, CLIResult } from '../../core/types';
import { resolveSymbol, buildSymbolQuery, isSymbolMode, SymbolResolveResult } from '../../symbolResolver';
import { sendDaemonRequest } from './daemonRequest';
import { stringToSymbolKind, symbolKindToString } from '../../core/utils/symbolKind';

/**
 * 解析文件路径（确保是绝对路径）
 */
export function resolveFilePath(filePath: string, projectPath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(projectPath, filePath);
}

/**
 * 通过符号名称解析位置
 * @returns 成功返回 { line, col }，失败返回错误结果
 */
export async function resolvePositionBySymbol(
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
export async function resolveGlobalPosition(
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
  
  // 过滤符号类型（如果指定）- 将字符串转换为数字进行比较
  const kindFilter = cmdOptions.kind || 'Method';
  const kindNumber = stringToSymbolKind(kindFilter);
  
  // 先按 kind 过滤，然后精确匹配名称
  const sameKindSymbols = symbols.filter((s: any) => 
    s.kind === kindNumber
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
    // workspace/symbol 返回的符号中，方法签名在 detail 字段
    // 格式通常为：methodName(paramType1, paramType2) : returnType
    const signatureFiltered = filtered.filter((s: any) => {
      // 优先使用 detail 字段，它包含完整签名信息
      const signatureSource = s.detail || s.containerName || '';
      return matchSignature(signatureSource, cmdOptions.signature);
    });
    
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
export async function getPosition(
  file: string | undefined,
  line: string | undefined,
  col: string | undefined,
  cmdOptions: any,
  opts: any
): Promise<{ filePath: string; line: string; col: string } | CLIResult<any>> {
  const projectPath = path.resolve(opts.project);
  
  // 全局定位模式：不需要文件路径
  if (cmdOptions.global && isSymbolMode(cmdOptions)) {
    // 验证 --kind 参数（全局定位必需）
    if (!cmdOptions.kind) {
      // 收集已提供的参数
      const providedParams = [];
      if (cmdOptions.method) providedParams.push('--method');
      if (cmdOptions.symbol) providedParams.push('--symbol');
      if (cmdOptions.global) providedParams.push('--global');
      if (cmdOptions.signature) providedParams.push('--signature');
      if (cmdOptions.index !== undefined) providedParams.push('--index');
      
      return {
        success: false,
        error: 'Missing required option: --kind. When using --global, you must specify --kind (e.g., Method, Class, Field, Interface).',
        data: {
          resolution_error: {
            type: 'missing_required_param',
            message: 'Missing required option: --kind',
            requiredParams: ['--kind'],
            providedParams,
            usage: 'jls <command> --global --symbol <name> --kind <Method|Class|Field|Interface>',
            examples: [
              'jls def --global --symbol "ArrayList" --kind Class',
              'jls def --global --symbol "openSession" --kind Method',
              'jls refs --global --symbol "length" --kind Field'
            ]
          }
        },
        elapsed: 0,
      };
    }
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
  
  // 验证行号和列号的有效性
  const lineNum = parseInt(line, 10);
  const colNum = parseInt(col, 10);
  
  if (isNaN(lineNum) || lineNum < 1) {
    return {
      success: false,
      error: `Invalid line number: ${line}. Line number must be a positive integer.`,
      elapsed: 0,
    };
  }
  
  if (isNaN(colNum) || colNum < 1) {
    return {
      success: false,
      error: `Invalid column number: ${col}. Column number must be a positive integer.`,
      elapsed: 0,
    };
  }
  
  // 检查行号是否超出文件范围
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    if (lineNum > lines.length) {
      return {
        success: false,
        error: `Line number ${lineNum} exceeds file length (${lines.length} lines).`,
        elapsed: 0,
      };
    }
    // 检查列号是否超出该行长度
    const targetLine = lines[lineNum - 1];
    if (colNum > targetLine.length + 1) {
      return {
        success: false,
        error: `Column number ${colNum} exceeds line ${lineNum} length (${targetLine.length} characters).`,
        elapsed: 0,
      };
    }
  } catch (error: any) {
    // 如果无法读取文件，继续执行（让后续处理报错）
  }
  
  return { filePath, line, col };
}

/**
 * 创建直接模式客户端
 */
export async function createDirectClient(options: any): Promise<JdtLsClient> {
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
export async function executeCommand(
  endpoint: string,
  body: any,
  directHandler: () => Promise<any>,
  opts: any,
  commandName?: string
): Promise<void> {
  const startTime = Date.now();
  const compact = opts.jsonCompact;
  const outputFile = opts.output;  // 获取--output参数
  
  // 如果禁用了守护进程，使用直接模式
  if (opts.daemon === false) {
    try {
      const result = await directHandler();
      outputResult({
        success: true,
        data: result,
        elapsed: Date.now() - startTime,
      }, commandName, compact, outputFile);
    } catch (error: any) {
      outputResult({
        success: false,
        error: error.message,
        elapsed: Date.now() - startTime,
      }, commandName, compact, outputFile);
    }
    return;
  }
  
  // 尝试守护进程模式
  const daemonResult = await sendDaemonRequest(endpoint, body);
  
  if (daemonResult.success || !daemonResult.error?.includes('Daemon not running')) {
    outputResult(daemonResult, commandName, compact, outputFile);
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
    }, commandName, compact, outputFile);
  } catch (error: any) {
    outputResult({
      success: false,
      error: error.message,
      elapsed: Date.now() - startTime,
    }, commandName, compact);
  }
}

// 需要从 outputHandler 导入，避免循环依赖
function outputResult<T>(
  result: any, 
  command?: string, 
  compact?: boolean,
  outputFile?: string
): void {
  const { compactData } = require('./outputHandler');
  const { ResponseMetadata } = require('../../core/types') as any;
  const fs = require('fs');
  
  let output = result;
  if (compact && result.data && command) {
    const metadata: any = {
      compactMode: true,
    };
    
    if (command === 'symbols' || command === 'sym') {
      (metadata as any).childrenExcluded = true;
    }
    
    output = { 
      ...result, 
      data: compactData(result.data, command) as T,
      metadata
    };
  }
  
  const jsonStr = JSON.stringify(output, null, compact ? 0 : 2);
  
  if (outputFile) {
    // 直接写UTF-8文件，绕过PowerShell的UTF-16 LE转换
    fs.writeFileSync(outputFile, jsonStr, 'utf8');
    console.log(`✅ Output written to: ${outputFile} (UTF-8)`);
  } else {
    // 输出到stdout（可能被PowerShell转码）
    console.log(jsonStr);
  }
  
  process.exit(result.success ? 0 : 1);
}

/**
 * 签名匹配（用于区分重载方法）
 */
export function matchSignature(signatureSource: string, expectedSignature: string): boolean {
  if (!signatureSource) return false;
  
  // 标准化签名格式
  const normalize = (sig: string) => sig.replace(/\s/g, '');
  
  const normalizedSource = normalize(signatureSource);
  const normalizedExpected = normalize(expectedSignature);
  
  // 检查是否包含预期的参数列表
  return normalizedSource.includes(`(${normalizedExpected})`);
}
