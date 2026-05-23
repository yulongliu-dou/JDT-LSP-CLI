/**
 * Type Definition 命令 - 类型定义
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls type-definition <file> [options]
       jls typedef <file> [options]

跳转到变量声明类型的定义（如变量类型 → 类定义）。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器路径，如 "MyClass.myMethod"
  --signature <sig>     方法签名区分重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         符号类型：Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  --explain-empty       调试选项：解释返回为空的原因
  -h, --help            显示帮助

Examples:
  jls typedef Service.java --method getRepository
  jls typedef Service.java --symbol repository --kind Field

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerTypeDefinitionCommand(program: Command) {
  let typeDefCmd = program
    .command('type-definition [file]')
    .alias('typedef')
    .description('跳转到变量声明类型的定义。')
    .configureHelp({ formatHelp: () => HELP })
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
    
    const { filePath, line: resolvedLine, col: resolvedCol } = posResult;
    const explainEmpty = cmdOptions.explainEmpty || false;
    
    await executeCommand(
      '/type-definition',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        explainEmpty,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          return await client.getTypeDefinition(filePath, parseInt(resolvedLine), parseInt(resolvedCol), explainEmpty);
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'typeDefinition'
    );
  });
}
