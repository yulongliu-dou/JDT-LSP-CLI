/**
 * Type Definition 命令 - 类型定义
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';

export function registerTypeDefinitionCommand(program: Command) {
  let typeDefCmd = program
    .command('type-definition [file] [line] [col]')
    .alias('typedef')
    .description('Go to type definition (e.g., variable type -> class). Use --symbol for auto-positioning.')
    .option('--explain-empty', 'Explain why type definition is empty (for debugging)', false);
  
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
  
  typeDefCmd.action(async (file: string, line: string | undefined, col: string | undefined, cmdOptions: any) => {
    const opts = program.opts();
    const projectPath = path.resolve(opts.project);
    
    // 解析位置（支持符号模式）
    const posResult = await getPosition(file, line, col, cmdOptions, opts);
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
