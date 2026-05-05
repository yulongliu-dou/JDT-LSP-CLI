/**
 * 反编译编排器
 *
 * 对单个 jar 执行全量 Vineflower 反编译，产出到全局缓存 `~/.lsp-cache/global/decompiled/<scope>/`。
 * 命中后对目标 fqcn 构建 lineMap，写入 `.decompiled-ok` 标记文件。
 *
 * 参见：[SP03 子计划 Task 3.3](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as globalCache from '../cache/globalCache';
import * as accessTracker from '../cache/accessTracker';
import { runVineflower, VineflowerError, detectJavaExecutable } from './vineflowerRunner';
import { buildLineMap, LineMap } from './lineMap';

export interface DecompileContext {
  /** 待反编译 jar 的绝对路径 */
  jarPath: string;
  /** 缓存 scope 键（用于 `decompiled/<scope>/` 目录定位，建议 GAV 形式） */
  scope: string;
  /** 目标全限定类名 */
  fqcn: string;
  /** Java 可执行文件路径（可选，不传则自动探测） */
  javaExe?: string;
  /** 反编译超时毫秒（默认 60s） */
  timeoutMs?: number;
}

export interface DecompileResult {
  /** 反编译产出的 .java 文件绝对路径 */
  filePath: string;
  /** 行号映射器 */
  lineMap: LineMap;
}

/**
 * 对目标 jar 执行全量反编译（若未命中缓存），返回指定类的结果。
 *
 * 流程：
 * 1. 检查 `globalCache.lookup('decompiled', scope, fqcn)` 是否命中
 * 2. 未命中 → 调用 `runVineflower(jarPath, scopeDir)` 全 jar 反编译
 * 3. 写入 `.decompiled-ok` 标记
 * 4. 构建 lineMap
 * 5. 失败写 `.failed` 标记，返回 null
 *
 * @returns 成功返回反编译结果；失败返回 null（调用方应降级到 classFileContents）
 */
export async function decompile(ctx: DecompileContext): Promise<DecompileResult | null> {
  const { jarPath, scope, fqcn } = ctx;

  // 1. 检查缓存命中
  const cachePath = globalCache.lookup('decompiled', scope, fqcn);
  if (cachePath) {
    accessTracker.touch('decompiled', scope);
    const lineMap = await buildLineMap(cachePath);
    return { filePath: cachePath, lineMap };
  }

  // 2. 检查是否已有 .decompiled-ok 标记（全 jar 已反编译但此 fqcn 可能在 jar 中不存在）
  const scopeDir = globalCache.scopeDir('decompiled', scope);
  const okMarker = path.join(scopeDir, '.decompiled-ok');

  if (fs.existsSync(okMarker)) {
    // 全 jar 已反编译，但目标 fqcn 不在此 jar 中（fqcn 与 jar 不匹配）
    return null;
  }

  // 3. 检查 .failed 标记（30 分钟内不重试）
  if (globalCache.isFailed('decompiled', scope)) {
    const failedPath = path.join(scopeDir, '.failed');
    try {
      const failed = JSON.parse(fs.readFileSync(failedPath, 'utf-8'));
      const age = Date.now() - (failed.ts || 0);
      const retryWindow = 30 * 60 * 1000; // 30 分钟
      if (age < retryWindow) {
        return null;
      }
      // 超时 → 清除 failed 标记，允许重试
      globalCache.clearFailed('decompiled', scope);
    } catch {
      globalCache.clearFailed('decompiled', scope);
    }
  }

  // 4. 执行全 jar 反编译
  const javaExe = ctx.javaExe || detectJavaExecutable();

  try {
    await runVineflower(jarPath, scopeDir, javaExe, scope, {
      timeoutMs: ctx.timeoutMs ?? 60_000,
    });
  } catch (err: unknown) {
    const reason = err instanceof VineflowerError
      ? `VineflowerError: ${err.message}`
      : `Unknown: ${String(err)}`;
    globalCache.markFailed('decompiled', scope, reason);
    return null;
  }

  // 5. 写入成功标记
  try {
    fs.writeFileSync(okMarker, JSON.stringify({ ts: Date.now(), jarPath }), 'utf-8');
  } catch {
    // ignore
  }

  // 6. 检查产物中是否有目标 fqcn
  const decompiledPath = globalCache.fileFor('decompiled', scope, fqcn);
  if (!fs.existsSync(decompiledPath)) {
    // 全 jar 反编译成功但目标 fqcn 不在产物中（fqcn 与 jar 不匹配）
    return null;
  }

  accessTracker.touch('decompiled', scope);

  const lineMap = await buildLineMap(decompiledPath);

  return { filePath: decompiledPath, lineMap };
}

/**
 * 检查给定 scope 的反编译是否已完成
 */
export function isDecompiled(scope: string): boolean {
  const okMarker = path.join(globalCache.scopeDir('decompiled', scope), '.decompiled-ok');
  return fs.existsSync(okMarker);
}
