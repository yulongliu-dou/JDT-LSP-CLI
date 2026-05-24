/**
 * explore-declaration — textDocument/declaration
 * 跳转到符号的声明位置（接口声明，非实现）。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-declaration.ts [project-path]
 */

import { runStandalone, resolveProject, METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'declaration',
  'textDocument/declaration',
  (c) => c.getDeclaration(config.mainFileFull, METHOD_POS.line, METHOD_POS.col),
  process.argv[2],
);
