/**
 * explore-typeDefinition — textDocument/typeDefinition
 * 跳转到变量的类型定义位置。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-typeDefinition.ts [project-path]
 */

import { runStandalone, resolveProject, BODY_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'typeDefinition',
  'textDocument/typeDefinition',
  (c) => c.getTypeDefinition(config.mainFileFull, BODY_POS.line, BODY_POS.col),
  process.argv[2],
);
