/**
 * explore-prepareRename — textDocument/prepareRename
 * 检查指定位置是否可重命名，返回可重命名的符号范围。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-prepareRename.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'prepareRename',
  'textDocument/prepareRename',
  (c) => c.getPrepareRename(config.mainFileFull, METHOD_POS.line, METHOD_POS.col),
  process.argv[2],
);
