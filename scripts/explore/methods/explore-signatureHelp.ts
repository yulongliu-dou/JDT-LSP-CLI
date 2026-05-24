/**
 * explore-signatureHelp — textDocument/signatureHelp
 * 获取方法调用的参数签名说明。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-signatureHelp.ts [project-path]
 */

import { runStandalone, resolveProject, BODY_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'signatureHelp',
  'textDocument/signatureHelp',
  (c) => c.getSignatureHelp(config.mainFileFull, BODY_POS.line, BODY_POS.col),
  process.argv[2],
);
