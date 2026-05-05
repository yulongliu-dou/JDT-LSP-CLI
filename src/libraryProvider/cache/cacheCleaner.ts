/**
 * 缓存清理器（TTL + workspace 死链回收）
 *
 * - `cleanStale(ttlDays)`：扫描 `global/<bucket>/` 下各 scope，
 *   基于 `accessTracker.getMaxTimestamp` 与 `Date.now() - ttlDays*86400000` 比较决定删除
 * - `cleanAll()`：无条件删除所有 scope（仅用于 CLI 诊断）
 * - `cleanWorkspaceDeadLinks(workspaceRoot)`：扫描 `<ws>/.lsp-cache/jars/`，readlink 指向不存在则 unlink
 * - 清理完成后调用 `accessTracker.compact()` 去重日志
 *
 * 本期仅提供 API；定时调度由 SP05 接入。
 *
 * 参见：[SP02 子计划 Task 2.4](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-%E7%BC%93%E5%AD%98%E4%B8%8EURI%E9%87%8D%E5%86%99_b2c3d4e5.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLspCacheRoot } from '../platform/pathUtils';
import { CacheBucket, scopeDir } from './globalCache';
import * as accessTracker from './accessTracker';

const BUCKETS: CacheBucket[] = ['sources', 'decompiled', 'jdk', 'class-file-contents'];

function globalRoot(): string {
  return path.join(getLspCacheRoot(), 'global');
}

export interface CleanStaleReport {
  /** 参与扫描的 scope 总数 */
  scanned: number;
  /** 实际删除的 scope 数 */
  removed: number;
  /** 详细（bucket/scope 列表） */
  removedScopes: string[];
}

/**
 * 列出 `bucket` 下的所有 scope（递归到"含 `.java` 文件"的叶目录）。
 *
 * 由于 scope 可能含 `/`（如 `jdk/21/java.base`），这里采用"向下搜索直到
 * 找到 `.java` / `.lock` / `.failed` / `.lastaccess` 任一标记即视为 scope 根"的启发策略。
 * 为避免误删，扫描深度限制为 5 层。
 */
function listScopes(bucket: CacheBucket): string[] {
  const root = path.join(globalRoot(), bucket);
  if (!fs.existsSync(root)) return [];
  const results: string[] = [];
  const stack: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: root, rel: '', depth: 0 },
  ];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.depth > 5) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasMarker = entries.some(
      (e) => e.isFile() && (e.name === '.lock' || e.name === '.failed' || e.name === '.lastaccess')
    );
    const hasJava = hasDescendantJava(cur.abs, 2);
    if (cur.rel && (hasMarker || hasJava)) {
      results.push(cur.rel.replace(/\\/g, '/'));
      continue; // 已视为 scope 根，不继续下钻
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      stack.push({
        abs: path.join(cur.abs, e.name),
        rel: cur.rel ? path.join(cur.rel, e.name) : e.name,
        depth: cur.depth + 1,
      });
    }
  }
  return results;
}

function hasDescendantJava(dir: string, maxDepth: number): boolean {
  if (maxDepth < 0) return false;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.java')) return true;
      if (e.isDirectory() && hasDescendantJava(path.join(dir, e.name), maxDepth - 1)) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * 删除 scope 目录及其 workspace 中对应 link / 拷贝。
 * workspace 端的清理由 cleanWorkspaceDeadLinks 统一处理。
 */
function removeScope(bucket: CacheBucket, scope: string): void {
  const dir = scopeDir(bucket, scope);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore 单 scope 删除失败
  }
}

/**
 * 清理 TTL 过期 scope。
 *
 * @param ttlDays 过期天数，<=0 表示视为 `cleanAll`
 */
export async function cleanStale(ttlDays: number): Promise<CleanStaleReport> {
  if (!fs.existsSync(globalRoot())) {
    return { scanned: 0, removed: 0, removedScopes: [] };
  }
  const threshold = ttlDays > 0 ? Date.now() - ttlDays * 86_400_000 : Date.now() + 1;
  const removedScopes: string[] = [];
  let scanned = 0;
  for (const bucket of BUCKETS) {
    for (const scope of listScopes(bucket)) {
      scanned += 1;
      const ts = await accessTracker.getMaxTimestamp(bucket, scope);
      // ts === 0 表示无访问记录：按"创建后从未访问"处理，只在 ttl > 0 时按创建时间判定
      const mtime = ts > 0 ? ts : getDirMtime(scopeDir(bucket, scope));
      if (mtime > 0 && mtime < threshold) {
        removeScope(bucket, scope);
        removedScopes.push(`${bucket}/${scope}`);
      }
    }
  }
  // 清理后压缩 access.log
  try { await accessTracker.compact(); } catch { /* ignore */ }
  return { scanned, removed: removedScopes.length, removedScopes };
}

function getDirMtime(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 无条件清空全局缓存（危险操作，仅 CLI 诊断用）。
 */
export async function cleanAll(): Promise<CleanStaleReport> {
  const removed: string[] = [];
  if (!fs.existsSync(globalRoot())) {
    return { scanned: 0, removed: 0, removedScopes: [] };
  }
  for (const bucket of BUCKETS) {
    for (const scope of listScopes(bucket)) {
      removeScope(bucket, scope);
      removed.push(`${bucket}/${scope}`);
    }
  }
  try { await accessTracker.compact(); } catch { /* ignore */ }
  return { scanned: removed.length, removed: removed.length, removedScopes: removed };
}

export interface DeadLinkReport {
  scanned: number;
  removed: number;
  removedPaths: string[];
}

/**
 * 扫描 `<workspace>/.lsp-cache/jars/` 下的符号链接，
 * readlink 指向目标不存在则 unlink。
 *
 * 注意：拷贝降级产生的是目录（非 symlink），不在此处清理，
 * 交由 `cleanStale` 通过删除全局 scope 侧带走。
 */
export function cleanWorkspaceDeadLinks(workspaceRoot: string): DeadLinkReport {
  const jarsRoot = path.join(workspaceRoot, '.lsp-cache', 'jars');
  if (!fs.existsSync(jarsRoot)) {
    return { scanned: 0, removed: 0, removedPaths: [] };
  }
  const removed: string[] = [];
  let scanned = 0;
  const stack: string[] = [jarsRoot];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isSymbolicLink()) {
        scanned += 1;
        let ok = false;
        try {
          const target = fs.readlinkSync(full);
          const abs = path.isAbsolute(target) ? target : path.resolve(cur, target);
          ok = fs.existsSync(abs);
        } catch {
          ok = false;
        }
        if (!ok) {
          try {
            fs.unlinkSync(full);
            removed.push(full);
          } catch { /* ignore */ }
        }
      } else if (e.isDirectory()) {
        stack.push(full);
      }
    }
  }
  return { scanned, removed: removed.length, removedPaths: removed };
}
