/**
 * Semantic Tokens 命令 - 获取文件中每个 token 的精确类型
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { decodeSemanticTokens } from '../../core/utils/semanticTokens';

import { SEMANTIC_TOKENS_HELP } from './help/semanticTokensHelp';

export function registerSemanticTokensCommand(program: Command) {
  let cmd = program
    .command('semantic-tokens [file]')
    .alias('semtok')
    .description('获取文件中每个 token 的精确类型（方法、变量、类、参数等）。');

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

  cmd.configureHelp({ formatHelp: () => SEMANTIC_TOKENS_HELP })
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();

      const hasSymbol = !!(cmdOptions.symbol || cmdOptions.method);
      if (hasSymbol) {
        const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'semtok');
        if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }
      } else if (!file) {
        outputResult({
          success: false,
          error: 'Missing file path. Use --symbol for targeted tokens.',
          data: { validation: { code: 'MISSING_PARAM', message: '缺少文件路径' } },
          elapsed: 0,
        }, undefined, opts.jsonCompact, opts.output);
        return;
      }

      const projectPath = path.resolve(opts.project);
      let fp: string;
      let sharedClient: any = undefined;

      if (hasSymbol) {
        const posResult = await getPosition(file, cmdOptions, opts);
        if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }
        fp = posResult.filePath;
        sharedClient = posResult.sharedClient;
      } else {
        fp = path.isAbsolute(file) ? file : path.resolve(projectPath, file);
      }

      await executeCommand('/semantic-tokens', {
        project: projectPath, file: fp,
        _sharedClient: sharedClient,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async (client) => {
        const raw = await client.getSemanticTokens(fp);
        const legend = client.getSemanticTokensLegend();
        return decodeSemanticTokens(raw, legend);
      }, opts, 'semanticTokens');
    });
}
