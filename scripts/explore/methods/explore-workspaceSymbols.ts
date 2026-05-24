/**
 * explore-workspaceSymbols — workspace/symbol
 * 全局搜索类、方法、字段等符号。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-workspaceSymbols.ts [project-path]
 */

import { runStandalone, resolveProject } from '../lib/shared';

const config = resolveProject(process.argv[2]);

runStandalone(
  'workspaceSymbols',
  'workspace/symbol',
  (c) => c.getWorkspaceSymbols('SqlSession', 10),
  process.argv[2],
);
