/**
 * explore-symbols — textDocument/documentSymbol
 * 列出文件中的所有符号（类、方法、字段等）。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-symbols.ts [project-path]
 */

import { runStandalone, resolveProject, MAIN_FILE } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'symbols',
  'textDocument/documentSymbol',
  (c) => c.getDocumentSymbols(config.mainFileFull),
  process.argv[2],
);
