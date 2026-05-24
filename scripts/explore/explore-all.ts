/**
 * explore-all — 批量运行所有 LSP 探路脚本
 *
 * 启动一个 JDT LS 实例，依次调用所有已接入的 LSP 方法，原始返回数据
 * 保存到 test-output/explore/<name>.json。
 *
 * 用法:
 *   npm run explore [project-path]
 *   npx ts-node --project scripts/explore/tsconfig.json scripts/explore/explore-all.ts [project-path]
 *
 * 也可以单独运行某个方法的探路脚本：
 *   npx ts-node --project scripts/explore/tsconfig.json scripts/explore/methods/explore-definition.ts
 */

import * as fs from 'fs';
import { JdtLsClient } from '../../src/jdt/client';
import {
  resolveProject,
  ensureDir,
  saveResult,
  createClient,
  MAIN_FILE,
  INTERFACE_FILE,
  METHOD_POS,
  BODY_POS,
  IFACE_METHOD_POS,
} from './lib/shared';

// ============================================================
// 探索条目定义
// ============================================================

interface ExploreEntry {
  name: string;
  lspMethod: string;
  call: (client: JdtLsClient, cfg: ReturnType<typeof resolveProject>) => Promise<any>;
}

const entries: ExploreEntry[] = [

  // ---- 仅需文件路径 ----
  { name: 'diagnostics',       lspMethod: 'textDocument/publishDiagnostics',  call: (c, g) => c.getDiagnostics(g.mainFileFull) },
  { name: 'semanticTokens',    lspMethod: 'textDocument/semanticTokens/full', call: (c, g) => c.getSemanticTokens(g.mainFileFull) },
  { name: 'codeLens',          lspMethod: 'textDocument/codeLens',            call: (c, g) => c.getCodeLens(g.mainFileFull) },
  { name: 'formatting',        lspMethod: 'textDocument/formatting',          call: (c, g) => c.getFormatting(g.mainFileFull) },
  { name: 'symbols',           lspMethod: 'textDocument/documentSymbol',      call: (c, g) => c.getDocumentSymbols(g.mainFileFull) },

  // ---- 方法名位置 ----
  { name: 'definition',        lspMethod: 'textDocument/definition',          call: (c, g) => c.getDefinition(g.mainFileFull, METHOD_POS.line, METHOD_POS.col) },
  { name: 'references',        lspMethod: 'textDocument/references',          call: (c, g) => c.getReferences(g.mainFileFull, METHOD_POS.line, METHOD_POS.col, false) },
  { name: 'hover',             lspMethod: 'textDocument/hover',               call: (c, g) => c.getHover(g.mainFileFull, METHOD_POS.line, METHOD_POS.col) },
  { name: 'declaration',       lspMethod: 'textDocument/declaration',         call: (c, g) => c.getDeclaration(g.mainFileFull, METHOD_POS.line, METHOD_POS.col) },
  { name: 'documentHighlight', lspMethod: 'textDocument/documentHighlight',   call: (c, g) => c.getDocumentHighlight(g.mainFileFull, METHOD_POS.line, METHOD_POS.col) },
  { name: 'prepareRename',     lspMethod: 'textDocument/prepareRename',       call: (c, g) => c.getPrepareRename(g.mainFileFull, METHOD_POS.line, METHOD_POS.col) },
  { name: 'rename',            lspMethod: 'textDocument/rename',              call: (c, g) => c.getRename(g.mainFileFull, METHOD_POS.line, METHOD_POS.col, 'renamedMethod') },

  // ---- 方法体内部位置 ----
  { name: 'inlayHint',         lspMethod: 'textDocument/inlayHint',           call: (c, g) => c.getInlayHint(g.mainFileFull, BODY_POS.line, BODY_POS.col) },
  { name: 'codeAction',        lspMethod: 'textDocument/codeAction',          call: (c, g) => c.getCodeAction(g.mainFileFull, BODY_POS.line, BODY_POS.col) },
  { name: 'completion',        lspMethod: 'textDocument/completion',          call: (c, g) => c.getCompletion(g.mainFileFull, BODY_POS.line, BODY_POS.col) },
  { name: 'signatureHelp',     lspMethod: 'textDocument/signatureHelp',       call: (c, g) => c.getSignatureHelp(g.mainFileFull, BODY_POS.line, BODY_POS.col) },

  // ---- 特殊文件/位置 ----
  { name: 'implementations',   lspMethod: 'textDocument/implementation',      call: (c, g) => c.getImplementations(g.interfaceFileFull, IFACE_METHOD_POS.line, IFACE_METHOD_POS.col) },
  { name: 'typeDefinition',    lspMethod: 'textDocument/typeDefinition',      call: (c, g) => c.getTypeDefinition(g.mainFileFull, BODY_POS.line, BODY_POS.col) },

  // ---- 查询类 ----
  { name: 'workspaceSymbols',  lspMethod: 'workspace/symbol',                 call: (_c, _g) => _c.getWorkspaceSymbols('SqlSession', 10) },

  // ---- 调用链 ----
  { name: 'prepareCallHierarchy', lspMethod: 'textDocument/prepareCallHierarchy', call: (c, g) => c.prepareCallHierarchy(g.mainFileFull, METHOD_POS.line, METHOD_POS.col) },
];

// ============================================================
// 主流程
// ============================================================

async function main() {
  const config = resolveProject(process.argv[2]);

  console.log('============================================================');
  console.log('  JDT LSP 探路 — 批量收集所有 LSP 方法原始返回数据');
  console.log('============================================================');
  console.log(`  项目路径: ${config.projectPath}`);
  console.log(`  输出目录: ${config.outputDir}`);
  console.log('');

  if (!fs.existsSync(config.projectPath)) {
    console.error(`错误：项目路径不存在: ${config.projectPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(config.mainFileFull)) {
    console.error(`错误：测试文件不存在: ${config.mainFileFull}`);
    process.exit(1);
  }

  ensureDir(config.outputDir);

  // 启动 JDT LS
  console.log('[1/2] 启动 JDT LS ...');
  let client: JdtLsClient;
  try {
    client = await createClient(config.projectPath);
    console.log('  JDT LS 启动完成\n');
  } catch (e: any) {
    console.error(`  JDT LS 启动失败: ${e.message}`);
    for (const entry of entries) {
      saveResult(config.outputDir, entry.name, entry.lspMethod, null, `JDT LS 启动失败: ${e.message}`);
    }
    saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', null, 'JDT LS 启动失败');
    saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', null, 'JDT LS 启动失败');
    process.exit(1);
  }

  // 逐个执行
  console.log('[2/2] 探索 LSP 方法 ...\n');

  let successCount = 0;
  let failCount = 0;

  for (const entry of entries) {
    console.log(`  [${entry.name}] ${entry.lspMethod}`);
    try {
      const rawResult = await entry.call(client, config);
      saveResult(config.outputDir, entry.name, entry.lspMethod, rawResult);
      successCount++;
    } catch (e: any) {
      saveResult(config.outputDir, entry.name, entry.lspMethod, null, `Error: ${e.message || String(e)}`);
      failCount++;
      console.log(`    -> ERROR: ${e.message || String(e)}`);
    }
  }

  // ---- Call Hierarchy: Incoming / Outgoing ----
  const chFile = fs.existsSync(require('path').join(config.outputDir, 'prepareCallHierarchy.json'))
    ? JSON.parse(require('fs').readFileSync(require('path').join(config.outputDir, 'prepareCallHierarchy.json'), 'utf-8'))
    : null;

  if (chFile?.success && Array.isArray(chFile.rawResponse) && chFile.rawResponse.length > 0) {
    const firstItem = chFile.rawResponse[0];

    console.log('  [incomingCalls] callHierarchy/incomingCalls');
    try {
      const incoming = await client.getIncomingCalls(firstItem);
      saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', incoming);
      successCount++;
    } catch (e: any) {
      saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', null, `Error: ${e.message || String(e)}`);
      failCount++;
      console.log(`    -> ERROR: ${e.message || String(e)}`);
    }

    console.log('  [outgoingCalls] callHierarchy/outgoingCalls');
    try {
      const outgoing = await client.getOutgoingCalls(firstItem);
      saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', outgoing);
      successCount++;
    } catch (e: any) {
      saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', null, `Error: ${e.message || String(e)}`);
      failCount++;
      console.log(`    -> ERROR: ${e.message || String(e)}`);
    }
  } else {
    const msg = 'prepareCallHierarchy 无结果，跳过';
    saveResult(config.outputDir, 'incomingCalls', 'callHierarchy/incomingCalls', null, msg);
    saveResult(config.outputDir, 'outgoingCalls', 'callHierarchy/outgoingCalls', null, msg);
    failCount += 2;
    console.log('  [incomingCalls/outgoingCalls] 跳过：prepareCallHierarchy 无结果');
  }

  // 关闭
  console.log('\n  正在关闭 JDT LS ...');
  await client.stop();

  console.log('\n============================================================');
  console.log(`  探路完成：成功 ${successCount} / 失败 ${failCount}`);
  console.log(`  原始数据已保存到: ${config.outputDir}`);
  console.log('============================================================');
}

main().catch((e) => {
  console.error('未预期的错误:', e);
  process.exit(1);
});
