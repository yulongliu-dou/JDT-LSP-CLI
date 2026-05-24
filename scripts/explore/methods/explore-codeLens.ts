/**
 * explore-codeLens — textDocument/codeLens
 * 获取方法的引用计数和 Override 标注。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-codeLens.ts [project-path]
 */

import { runStandalone, resolveProject, MAIN_FILE } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'codeLens',
  'textDocument/codeLens',
  (c) => c.getCodeLens(config.mainFileFull),
  process.argv[2],
);
