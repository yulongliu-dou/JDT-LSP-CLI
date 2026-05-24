/**
 * explore-implementations — textDocument/implementation
 * 查找接口方法的所有实现。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-implementations.ts [project-path]
 */

import { runStandalone, resolveProject, IFACE_METHOD_POS } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'implementations',
  'textDocument/implementation',
  (c) => c.getImplementations(config.interfaceFileFull, IFACE_METHOD_POS.line, IFACE_METHOD_POS.col),
  process.argv[2],
);
