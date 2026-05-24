/**
 * explore-completion — textDocument/completion
 * 获取指定位置的代码补全候选列表。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-completion.ts [project-path]
 */

import { runStandalone, resolveProject, BODY_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'completion',
  'textDocument/completion',
  (c) => c.getCompletion(config.mainFileFull, BODY_POS.line, BODY_POS.col),
  process.argv[2],
);
