/**
 * explore-formatting — textDocument/formatting
 * 获取文件的格式化编辑列表（TextEdit 数组）。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-formatting.ts [project-path]
 */

import { runStandalone, resolveProject, MAIN_FILE } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'formatting',
  'textDocument/formatting',
  (c) => c.getFormatting(config.mainFileFull),
  process.argv[2],
);
