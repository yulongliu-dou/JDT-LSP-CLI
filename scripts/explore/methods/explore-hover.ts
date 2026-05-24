/**
 * explore-hover — textDocument/hover
 * 获取符号的 Javadoc 文档和类型信息。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-hover.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'hover',
  'textDocument/hover',
  (c) => c.getHover(config.mainFileFull, METHOD_POS.line, METHOD_POS.col),
  process.argv[2],
);
