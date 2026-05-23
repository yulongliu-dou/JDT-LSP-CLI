/**
 * References 命令 - 查找引用
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls references <file> [options]
       jls refs <file> [options]

查找符号的所有引用。

Options:
  --method <name>       方法名（自动解析位置）
  --symbol <name>       符号名（自动解析位置）
  --container <path>    父容器路径，如 "MyClass.myMethod"
  --signature <sig>     方法签名区分重载，如 "(String, int)"
  --index <n>           多个匹配时选择（从 0 开始）
  --kind <type>         符号类型：Method | Field | Class | Interface
  --global              全局搜索（需同时指定 --symbol 和 --kind）
  --no-declaration      排除声明本身
  -h, --help            显示帮助

Examples:
  jls refs Service.java --method processOrder
  jls refs Service.java --method process --no-declaration
  jls refs Service.java --symbol myField

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerReferencesCommand(program: Command) {
  let referencesCmd = program
    .command('references [file]')
    .alias('refs')
    .description('查找符号的所有引用。')
    .configureHelp({ formatHelp: () => HELP })
    .option('--no-declaration', '排除声明本身');
  
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
    referencesCmd = referencesCmd.option(opt.flags, opt.desc);
  }
  
  referencesCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    // 防呆：校验参数合法性
    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'refs');
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
}
