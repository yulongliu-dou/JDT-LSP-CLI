/**
 * Definition 命令 - 跳转到定义
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { resolveSymbol, buildSymbolQuery } from '../../symbolResolver';
import { validateFileSymbolCommand } from '../utils/paramValidator';

// ── Help ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: jls definition <file> [options]
       jls def <file> [options]

跳转到符号的定义位置。

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
  jls def Service.java --method processOrder
  jls def Service.java --method process --signature "(String, int)"
  jls def Service.java --method process --index 1
  jls def --global --symbol ArrayList --kind Class

On ambiguity:
  多个符号匹配时，使用 --index 0/1/2 选择。
  使用 --signature 区分重载方法。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerDefinitionCommand(program: Command) {
  let definitionCmd = program
    .command('definition [file]')
    .alias('def')
    .description('跳转到符号的定义位置。')
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
    definitionCmd = definitionCmd.option(opt.flags, opt.desc);
  }

  definitionCmd.action(async (file: string, cmdOptions: any) => {
    const opts = program.opts();

    // 防呆：校验参数合法性
    const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'def');
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
      '/definition',
      {
        project: projectPath,
        file: filePath,
        line: resolvedLine,
        col: resolvedCol,
        symbol: cmdOptions.symbol,
        kind: cmdOptions.kind,
        index: cmdOptions.index,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      },
      async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          let finalLine = parseInt(resolvedLine);
          let finalCol = parseInt(resolvedCol);
          // 对 global 模式下解析到的外部文件，用文档符号重新精确定位
          if (cmdOptions.global && cmdOptions.symbol && cmdOptions.kind) {
            try {
              const symbols = await client.getDocumentSymbols(filePath);
              const symbolQuery = buildSymbolQuery({
                symbol: cmdOptions.symbol,
                kind: cmdOptions.kind,
                index: cmdOptions.index,
              });
              if (symbolQuery) {
                const result = resolveSymbol(symbols, symbolQuery, 'definition');
                if (result.success) {
                  finalLine = result.position.line;
                  finalCol = result.position.character;
                }
              }
            } catch {
              // 文档符号定位失败，继续使用原位置
            }
          }
          return await client.getDefinition(filePath, finalLine, finalCol);
        } finally {
          if (client) await client.stop();
        }
      },
      opts,
      'definition'
    );
  });
}

async function createDirectClient(options: any): Promise<JdtLsClient> {
  const { JdtLsClient } = require('../../jdtClient');
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
