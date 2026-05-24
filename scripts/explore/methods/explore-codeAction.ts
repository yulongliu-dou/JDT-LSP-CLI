/**
 * explore-codeAction — textDocument/codeAction
 * 获取指定位置的快速修复和重构操作列表。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-codeAction.ts [project-path]
 */

import { runStandalone, resolveProject, BODY_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'codeAction',
  'textDocument/codeAction',
  (c) => c.getCodeAction(config.mainFileFull, BODY_POS.line, BODY_POS.col),
  process.argv[2],
);
