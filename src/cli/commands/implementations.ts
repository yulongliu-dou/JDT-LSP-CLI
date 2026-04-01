/**
 * Implementations 命令 - 查找实现
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand, createDirectClient } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';

export function registerImplementationsCommand(program: Command) {
  let implementationsCmd = program
    .command('implementations [file] [line] [col]')
    .alias('impl')
    .description('Find implementations. Use --symbol for auto-positioning.');
  
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
}
