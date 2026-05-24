/**
 * explore-diagnostics — textDocument/publishDiagnostics
 * 获取文件的编译错误和警告。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-diagnostics.ts [project-path]
 */

import { runStandalone, resolveProject, MAIN_FILE } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'diagnostics',
  'textDocument/publishDiagnostics',
  (c) => c.getDiagnostics(config.mainFileFull),
  process.argv[2],
);
