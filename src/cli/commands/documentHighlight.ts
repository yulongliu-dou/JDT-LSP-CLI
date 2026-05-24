/**
 * Document Highlight 命令 - 查找同一文件内对某符号的引用高亮位置
 */

import { Command } from 'commander';
import * as path from 'path';
import { getPosition, executeCommand } from '../utils/positionResolver';
import { outputResult } from '../utils/outputHandler';
import { JdtLsClient } from '../../jdtClient';
import { validateFileSymbolCommand } from '../utils/paramValidator';
import { DocumentHighlightKindMap } from '../../core/types';

import { DOCUMENT_HIGHLIGHT_HELP } from './help/documentHighlightHelp';

export function registerDocumentHighlightCommand(program: Command) {
  let cmd = program
    .command('document-highlight [file]')
    .alias('highlight')
    .description('查找同一文件内所有对某符号的引用位置，区分 read/write/text 类型。');

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

  cmd.configureHelp({ formatHelp: () => DOCUMENT_HIGHLIGHT_HELP })
    .action(async (file: string, cmdOptions: any) => {
      const opts = program.opts();

      const validationError = validateFileSymbolCommand(file, cmdOptions, opts, 'highlight');
      if (validationError) { outputResult(validationError, undefined, opts.jsonCompact, opts.output); return; }

      const projectPath = path.resolve(opts.project);
      const posResult = await getPosition(file, cmdOptions, opts);
      if ('success' in posResult) { outputResult(posResult, undefined, opts.jsonCompact, opts.output); return; }

      const { filePath: fp, line, col } = posResult;

      await executeCommand('/document-highlight', {
        project: projectPath, file: fp, line, col,
        options: { verbose: opts.verbose, jdtlsPath: opts.jdtlsPath },
      }, async () => {
        let client: JdtLsClient | null = null;
        try {
          client = await createDirectClient(opts);
          const highlights = await client.getDocumentHighlight(fp, parseInt(line), parseInt(col));
          const mapped = Array.isArray(highlights)
            ? highlights.map((h: any) => ({ ...h, kind: DocumentHighlightKindMap[h.kind] || h.kind }))
            : highlights;
          return { highlights: mapped, count: Array.isArray(mapped) ? mapped.length : 0 };
        } finally { if (client) await client.stop(); }
      }, opts, 'documentHighlight');
    });
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
