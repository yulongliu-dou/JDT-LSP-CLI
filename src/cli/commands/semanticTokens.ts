/**
 * Semantic Tokens 命令 - 获取文件中每个 token 的精确类型
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';

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

      if (hasSymbol) {
        const posResult = await getPosition(file, cmdOptions, opts);
        if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }
        fp = posResult.filePath;
      } else {
        fp = path.isAbsolute(file) ? file : path.resolve(projectPath, file);
      }

      await executeCommand('/semantic-tokens', {
        project: projectPath, file: fp,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const raw = await client.getSemanticTokens(fp);
          const legend = client.getSemanticTokensLegend();
          return decodeSemanticTokens(raw, legend);
        } finally { if (client) await client.stop(); }
      }, opts, 'semanticTokens');
    });
}

function decodeSemanticTokens(raw: any, legend?: { tokenTypes: string[]; tokenModifiers: string[] } | null) {
  const data = raw?.data;
  if (!data || !Array.isArray(data)) return { tokens: [], count: 0 };

  const tokenTypeNames = legend?.tokenTypes || [];
  const tokenModifierNames = legend?.tokenModifiers || [];

  const tokens: any[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaStartChar = data[i + 1];
    const length = data[i + 2];
    const tokenType = data[i + 3];
    const tokenModifiers = data[i + 4];

    const line = deltaLine === 0 ? prevLine : prevLine + deltaLine;
    const startChar = deltaLine === 0 ? prevChar + deltaStartChar : deltaStartChar;

    const decodedModifiers: string[] = [];
    if (tokenModifierNames.length > 0) {
      for (let bit = 0; bit < tokenModifierNames.length; bit++) {
        if (tokenModifiers & (1 << bit)) {
          decodedModifiers.push(tokenModifierNames[bit]);
        }
      }
    }

    tokens.push({
      line,
      startChar,
      length,
      tokenType: tokenTypeNames[tokenType] || tokenType,
      tokenModifiers: decodedModifiers.length > 0 ? decodedModifiers : tokenModifiers,
    });

    prevLine = line;
    prevChar = startChar;
  }

  return { tokens, count: tokens.length, resultId: raw.resultId };
}

async function createDirectClient(options: any): Promise<JdtLsClient> {
  const { JdtLsClient } = require('../../jdtClient');
  const client = new JdtLsClient({
    projectPath: path.resolve(options.project), jdtlsPath: options.jdtlsPath,
    dataDir: options.dataDir, timeout: parseInt(options.timeout, 10), verbose: options.verbose,
  });
  await client.start();
  return client;
}
