/**
 * Signature Help 命令 - 获取方法调用处的参数签名说明
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';

import { SIGNATURE_HELP } from './help/signatureHelp';

export function registerSignatureHelpCommand(program: Command) {
  let cmd = program
    .command('signature-help [file]')
    .alias('sig')
    .description('获取方法调用处的参数签名说明（参数名、类型、当前激活参数）。');

  const symbolOptions = [
    { flags: '--method <name>', desc: 'Method name to locate' },
    { flags: '--symbol <name>', desc: 'Symbol name to locate' },
    { flags: '--container <path>', desc: 'Parent container path' },
    { flags: '--signature <sig>', desc: 'Method signature for overloads' },
    { flags: '--index <n>', desc: 'Index for multiple matches (0-based)' },
    { flags: '--kind <type>', desc: 'Symbol kind: Method, Field, Class, Interface' },
    { flags: '--global', desc: 'Global search (requires --symbol AND --kind)' },
  ];

  for (const opt of symbolOptions) { cmd = cmd.option(opt.flags, opt.desc); }

  cmd.configureHelp({ formatHelp: () => SIGNATURE_HELP })
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();

      const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'sig');
      if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }

      const projectPath = path.resolve(opts.project);
      const posResult = await getPosition(file, cmdOptions, opts);
      if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }

      const { filePath: fp, line, col, sharedClient } = posResult;

      await executeCommand('/signature-help', {
        project: projectPath, file: fp, line, col,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async (client) => {
        return await client.getSignatureHelp(fp, parseInt(line), parseInt(col));
      }, opts, 'signatureHelp');
    });
}
