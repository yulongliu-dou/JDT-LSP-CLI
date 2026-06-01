/**
 * Type Definition 命令 - 类型定义
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { initDirectModeRewriter, rewriteDirectLocations } from '../utils/directModeRewriter';

import { TYPE_DEFINITION_HELP } from './help/typeDefinitionHelp';

// ── Command ───────────────────────────────────────────────────────────────────

export function registerTypeDefinitionCommand(program: Command) {
  let typeDefCmd = program
    .command('type-definition [file]')
    .alias('typedef')
    .description('跳转到变量声明类型的定义。')
    .configureHelp({ formatHelp: () => TYPE_DEFINITION_HELP })
    .option('--explain-empty', '调试选项：解释返回为空的原因', false);
  
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
    typeDefCmd = typeDefCmd.option(opt.flags, opt.desc);
  }
  
  typeDefCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    // 防呆：校验参数合法性
    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'typedef');
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
    const explainEmpty = cmdOptions.explainEmpty || false;

    await executeCommand(
      '/type-definition',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        explainEmpty,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async (client) => {
        await initDirectModeRewriter(client, projectPath);
        const result = await client.getTypeDefinition(filePath, parseInt(resolvedLine), parseInt(resolvedCol), explainEmpty);
        // 对齐 daemon handleTypeDefinition 的格式保留逻辑
        if (!result) return { locations: [], count: 0 };
        if (result.locations && Array.isArray(result.locations)) {
          result.locations = await rewriteDirectLocations(result.locations);
          return result;
        }
        if (Array.isArray(result)) {
          const rewritten = await rewriteDirectLocations(result);
          return { locations: rewritten, count: rewritten.length };
        }
        return result;
      },
      opts,
      'typeDefinition'
    );
  });
}
