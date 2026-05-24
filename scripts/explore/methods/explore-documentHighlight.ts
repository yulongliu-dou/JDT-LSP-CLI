/**
 * explore-documentHighlight — textDocument/documentHighlight
 * 单文件内符号引用的高亮位置列表。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-documentHighlight.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'documentHighlight',
  'textDocument/documentHighlight',
  (c) => c.getDocumentHighlight(config.mainFileFull, METHOD_POS.line, METHOD_POS.col),
  process.argv[2],
);
