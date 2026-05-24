/**
 * explore-inlayHint — textDocument/inlayHint
 * 获取方法的推断类型和参数名标注。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-inlayHint.ts [project-path]
 */

import { runStandalone, resolveProject, BODY_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'inlayHint',
  'textDocument/inlayHint',
  (c) => c.getInlayHint(config.mainFileFull, BODY_POS.line, BODY_POS.col),
  process.argv[2],
);
