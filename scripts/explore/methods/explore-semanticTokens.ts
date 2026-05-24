/**
 * explore-semanticTokens — textDocument/semanticTokens/full
 * 获取文件的语义 Token（方法/变量/类的精确类型标注）。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-semanticTokens.ts [project-path]
 */

import { runStandalone, resolveProject, MAIN_FILE } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'semanticTokens',
  'textDocument/semanticTokens/full',
  (c) => c.getSemanticTokens(config.mainFileFull),
  process.argv[2],
);
