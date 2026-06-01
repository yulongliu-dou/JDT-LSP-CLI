/**
 * Implementations 命令 - 查找实现
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { initDirectModeRewriter, rewriteDirectLocations } from '../utils/directModeRewriter';

import { IMPLEMENTATIONS_HELP } from './help/implementationsHelp';

// ── Command ───────────────────────────────────────────────────────────────────

export function registerImplementationsCommand(program: Command) {
  let implementationsCmd = program
    .command('implementations [file]')
    .alias('impl')
    .description('查找接口或抽象类的实现。')
    .configureHelp({ formatHelp: () => IMPLEMENTATIONS_HELP });
  
  // 添加符号定位选项
  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate (auto-resolve position)' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate (auto-resolve position)' },
    { flags: '--container <path>', desc: 'Parent container path, e.g., "MyClass.myMethod"' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads, e.g., "(String, int)"' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: '⚠️ Global search (requires --symbol AND --kind, JDT LS limitation)' },
  ];
  
  for (const opt of symbolOptions) {
    implementationsCmd = implementationsCmd.option(opt.flags, opt.desc);
  }
  
  implementationsCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    // 防呆：校验参数合法性
    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'impl');
    if (validationError) {
      outputResult(validationError, undefined, opts.jsonCompact, opts.output);
      return;
    }

    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, cmdOptions, opts);
    if ('success' in posResult) {
      outputResult(posResult, undefined, opts.jsonCompact, opts.output);
      return;
    }
    
    const { filePath, line: resolvedLine, col: resolvedCol, sharedClient } = posResult;

    await executeCommand(
      '/implementations',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async (client) => {
        await initDirectModeRewriter(client, projectPath);
        const result = await client.getImplementations(filePath, parseInt(resolvedLine), parseInt(resolvedCol));
        const rewritten = await rewriteDirectLocations(result);
        return { implementations: rewritten, count: rewritten.length };
      },
      opts,
      'implementations'
    );
  });
}
