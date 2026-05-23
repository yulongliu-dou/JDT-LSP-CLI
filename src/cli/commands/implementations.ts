/**
 * Implementations 命令 - 查找实现
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls implementations <file> [options]
       jls impl <file> [options]

查找接口或抽象类的实现。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器路径，如 "MyClass.myMethod"
  --signature <sig>     方法签名区分重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         符号类型：Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  -h, --help            显示帮助

Examples:
  jls impl Service.java --method process
  jls impl --global --symbol UserRepository --kind Interface

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerImplementationsCommand(program: Command) {
  let implementationsCmd = program
    .command('implementations [file]')
    .alias('impl')
    .description('查找接口或抽象类的实现。')
    .configureHelp({ formatHelp: () => HELP });
  
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
}
