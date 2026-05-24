/**
 * explore-references — textDocument/references
 * 查找符号的所有引用位置。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-references.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'references',
  'textDocument/references',
  (c) => c.getReferences(config.mainFileFull, METHOD_POS.line, METHOD_POS.col, false),
  process.argv[2],
);
