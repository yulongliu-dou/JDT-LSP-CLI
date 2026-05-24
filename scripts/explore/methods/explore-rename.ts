/**
 * explore-rename — textDocument/rename
 * 语义级重命名，返回 WorkspaceEdit（不做实际修改）。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-rename.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'rename',
  'textDocument/rename',
  (c) => c.getRename(config.mainFileFull, METHOD_POS.line, METHOD_POS.col, 'renamedMethod'),
  process.argv[2],
);
