/**
 * explore-definition — textDocument/definition
 * 跳转到符号的完整定义位置。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-definition.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'definition',
  'textDocument/definition',
  (c) => c.getDefinition(config.mainFileFull, METHOD_POS.line, METHOD_POS.col),
  process.argv[2],
);
