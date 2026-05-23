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

export function registerDefinitionCommand(program: Command) {
  let definitionCmd = program
    .command('definition [file]')
    .alias('def')
    .description('Go to definition of a symbol. Use --symbol for auto-positioning.');

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
