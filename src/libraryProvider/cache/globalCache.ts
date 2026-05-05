/**
 * 全局主本缓存（`~/.lsp-cache/global/`）
 *
 * 约定：
 * - 目录布局：`~/.lsp-cache/global/<bucket>/<scope>/<pkg>/<Class>.java`
 *   - bucket ∈ {`sources`, `decompiled`, `jdk`, `class-file-contents`}
 *   - scope 为每个来源内部的唯一键（如 GAV / JDK major+module / hash）
 * - 文件锁：`<bucket>/<scope>/.lock`，基元 `fs.mkdirSync` 原子失败重试；
 *   每 50ms 重试一次，最长 30s 放弃。
 * - 锁等待追加 `~/.lsp-cache/global/lock-wait.log`（单行 < 200 字节，便于并发 append 原子）。
 * - `.failed` 失败标记：`<bucket>/<scope>/.failed`，存 `{ reason, ts }`。
 *
 * 参见：[SP02 子计划 Task 2.1](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-%E7%BC%93%E5%AD%98%E4%B8%8EURI%E9%87%8D%E5%86%99_b2c3d4e5.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLspCacheRoot } from '../platform/pathUtils';

/** 全局缓存桶类型 */
export type CacheBucket = 'sources' | 'decompiled' | 'jdk' | 'class-file-contents';

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;

/** 将 fqcn 转为 `<pkg>/<Class>.java` 相对路径 */
function fqcnToRelPath(fqcn: string): string {
  if (!fqcn) return 'Unknown.java';
  return fqcn.replace(/\./g, '/') + '.java';
}

function globalRoot(): string {
  return path.join(getLspCacheRoot(), 'global');
}

/** `global/<bucket>/<scope>` 绝对路径 */
export function scopeDir(bucket: CacheBucket, scope: string): string {
  return path.join(globalRoot(), bucket, scope);
}

/** `global/<bucket>/<scope>/<pkg>/<Class>.java` 绝对路径（不保证存在） */
export function fileFor(bucket: CacheBucket, scope: string, fqcn: string): string {
  return path.join(scopeDir(bucket, scope), fqcnToRelPath(fqcn));
}

/**
 * 查询缓存。
 *
 * @returns 命中时返回绝对路径；未命中返回 null
 */
export function lookup(bucket: CacheBucket, scope: string, fqcn: string): string | null {
  const p = fileFor(bucket, scope, fqcn);
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    return null;
  }
  return null;
}

/**
 * 写入内容（原子写：tmp + rename，失败降级 copy + unlink）。
 *
 * @returns 写入文件绝对路径；抛错表示严重 I/O 失败
 */
export async function write(
  bucket: CacheBucket,
  scope: string,
  fqcn: string,
  content: string
): Promise<string> {
  const target = fileFor(bucket, scope, fqcn);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch {
    fs.copyFileSync(tmp, target);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  return target;
}

function lockWaitLogPath(): string {
  return path.join(globalRoot(), 'lock-wait.log');
}

function appendLockWait(scope: string, waitMs: number): void {
  if (waitMs <= 0) return;
  try {
    fs.mkdirSync(globalRoot(), { recursive: true });
    const line = `${new Date().toISOString()}|${scope}|${waitMs}|${process.pid}\n`;
    // 单行 < 200 字节，保证 Windows/macOS 并发 append 原子
    fs.appendFileSync(lockWaitLogPath(), line, 'utf-8');
  } catch {
    // 日志写失败不影响主流程
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 独占锁执行 `fn`。
 *
 * - 成功获得 `.lock` 目录 → 执行 → 最终 `rmdir .lock`
 * - 并发冲突 → 每 {@link LOCK_RETRY_MS}ms 重试，最长 {@link LOCK_TIMEOUT_MS}
 * - 超时 → 打印警告并强制执行（保证业务可向前推进；可能重复写入，但最后 rename 保证一致）
 *
 * @returns `{ result, waitMs }`；waitMs 为本次等待锁的累计毫秒
 */
export async function withLock<T>(
  bucket: CacheBucket,
  scope: string,
  fn: () => Promise<T>
): Promise<{ result: T; waitMs: number }> {
  const dir = scopeDir(bucket, scope);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, '.lock');

  const start = Date.now();
  let acquired = false;
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      break;
    } catch (err: any) {
      if (err && err.code === 'EEXIST') {
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      // 其它错误（权限等）：放弃锁，但依然尝试执行
      break;
    }
  }

  const waitMs = Date.now() - start;
  if (acquired) appendLockWait(scope, waitMs);

  try {
    const result = await fn();
    return { result, waitMs };
  } finally {
    if (acquired) {
      try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
    }
  }
}

/** 写入 `.failed` 标记（JSON：{ reason, ts }） */
export function markFailed(bucket: CacheBucket, scope: string, reason: string): void {
  try {
    const dir = scopeDir(bucket, scope);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.failed'),
      JSON.stringify({ reason, ts: Date.now() }),
      'utf-8'
    );
  } catch {
    // 失败标记记录失败本身不抛
  }
}

/** 是否有 `.failed` 标记 */
export function isFailed(bucket: CacheBucket, scope: string): boolean {
  try {
    return fs.existsSync(path.join(scopeDir(bucket, scope), '.failed'));
  } catch {
    return false;
  }
}

/** 清除 `.failed` 标记（供清理 / 手工重试使用） */
export function clearFailed(bucket: CacheBucket, scope: string): void {
  try {
    fs.unlinkSync(path.join(scopeDir(bucket, scope), '.failed'));
  } catch {
    // ignore
  }
}
