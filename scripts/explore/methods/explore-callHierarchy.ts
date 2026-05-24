/**
 * explore-callHierarchy — textDocument/prepareCallHierarchy
 *   + callHierarchy/incomingCalls + callHierarchy/outgoingCalls
 *
 * 分析方法的调用链（三合一脚本，因 incoming/outgoing 依赖 prepare 结果）。
 *
 * 用法: npx ts-node --project ../tsconfig.json explore-callHierarchy.ts [project-path]
 */

import * as path from 'path';
import * as fs from 'fs';
import { createClient, saveResult, ensureDir, resolveProject, METHOD_POS } from '../lib/shared';

async function main() {
  const config = resolveProject(process.argv[2]);
  ensureDir(config.outputDir);

  if (!fs.existsSync(config.projectPath)) {
    console.error(`错误：项目路径不存在: ${config.projectPath}`);
    process.exit(1);
  }

  console.log('[explore-callHierarchy] 启动 JDT LS ...');
  const client = await createClient(config.projectPath);

  try {
    // 1) prepareCallHierarchy
    console.log('[explore-callHierarchy] 调用 textDocument/prepareCallHierarchy ...');
    let prepareItems: any[];
    try {
      prepareItems = await client.prepareCallHierarchy(
        config.mainFileFull, METHOD_POS.line, METHOD_POS.col,
      );
      saveResult(config.outputDir, 'prepareCallHierarchy', 'textDocument/prepareCallHierarchy', prepareItems);
      console.log('  -> prepareCallHierarchy.json');
    } catch (e: any) {
      saveResult(config.outputDir, 'prepareCallHierarchy', 'textDocument/prepareCallHierarchy', null, `Error: ${e.message || String(e)}`);
      console.error(`  错误: ${e.message || String(e)}`);
      return;
    }

    if (!Array.isArray(prepareItems) || prepareItems.length === 0) {
      const msg = 'prepareCallHierarchy 返回空结果，跳过 incoming/outgoing';
      saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', null, msg);
      saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', null, msg);
      console.log(`  ${msg}`);
      return;
    }

    const firstItem = prepareItems[0];

    // 2) incomingCalls
    console.log('[explore-callHierarchy] 调用 callHierarchy/incomingCalls ...');
    try {
      const incoming = await client.getIncomingCalls(firstItem);
      saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', incoming);
      console.log('  -> incomingCalls.json');
    } catch (e: any) {
      saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', null, `Error: ${e.message || String(e)}`);
      console.error(`  错误: ${e.message || String(e)}`);
    }

    // 3) outgoingCalls
    console.log('[explore-callHierarchy] 调用 callHierarchy/outgoingCalls ...');
    try {
      const outgoing = await client.getOutgoingCalls(firstItem);
      saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', outgoing);
      console.log('  -> outgoingCalls.json');
    } catch (e: any) {
      saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', null, `Error: ${e.message || String(e)}`);
      console.error(`  错误: ${e.message || String(e)}`);
    }
  } finally {
    await client.stop();
  }

  console.log('[explore-callHierarchy] 完成');
}

main();
