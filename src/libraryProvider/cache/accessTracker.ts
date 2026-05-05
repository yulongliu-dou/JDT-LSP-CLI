/**
 * 访问追踪（`~/.lsp-cache/global/access.log` + 内存 Map）
 *
 * - 主通道：内存 Map，touch 时刻立即更新
 * - 附通道：append-only `access.log`（单行 `<unixMs>|<scope>\n`，< 200 字节），
 *   保证 Windows/macOS 并发 append 原子，确保 daemon 被 `kill -9` 后下次仍可重建 Map。
 * - flush：周期（或手动）把 memMap 写到 `<bucket>/<scope>/.lastaccess`
 *   供 cacheCleaner 决策，降低清理时对 access.log 的扫描成本。
 * - compact：去重 access.log，仅保留每 scope 最大时间戳。
 *
 * 参见：[SP02 子计划 Task 2.3](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-%E7%BC%93%E5%AD%98%E4%B8%8EURI%E9%87%8D%E5%86%99_b2c3d4e5.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLspCacheRoot } from '../platform/pathUtils';
import { scopeDir, CacheBucket } from './globalCache';

const ACCESS_LOG_NAME = 'access.log';
const LASTACCESS_FILE = '.lastaccess';

/** scopeKey = `<bucket>/<scope>` */
export type ScopeKey = string;

export function makeScopeKey(bucket: CacheBucket, scope: string): ScopeKey {
  return `${bucket}/${scope}`;
}

function parseScopeKey(key: ScopeKey): { bucket: CacheBucket; scope: string } | null {
  const idx = key.indexOf('/');
  if (idx <= 0) return null;
  const bucket = key.slice(0, idx) as CacheBucket;
  const scope = key.slice(idx + 1);
  if (!scope) return null;
  return { bucket, scope };
}

const memMap = new Map<ScopeKey, number>();
let replayed = false;

function globalRoot(): string {
  return path.join(getLspCacheRoot(), 'global');
}

function accessLogPath(): string {
  return path.join(globalRoot(), ACCESS_LOG_NAME);
}

function ensureReplayed(): void {
  if (replayed) return;
  replayed = true;
  const p = accessLogPath();
  if (!fs.existsSync(p)) return;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      const sep = line.indexOf('|');
      if (sep <= 0) continue;
      const ts = Number(line.slice(0, sep));
      const key = line.slice(sep + 1);
      if (!Number.isFinite(ts) || !key) continue;
      const prev = memMap.get(key) ?? 0;
      if (ts > prev) memMap.set(key, ts);
    }
  } catch {
    // 回放失败不阻塞主流程
  }
}

/**
 * 记录一次访问。主路径更新内存 Map；附路径 append 一行到 access.log。
 */
export function touch(bucket: CacheBucket, scope: string): void {
  ensureReplayed();
  const key = makeScopeKey(bucket, scope);
  const now = Date.now();
  memMap.set(key, now);
  try {
    fs.mkdirSync(globalRoot(), { recursive: true });
    fs.appendFileSync(accessLogPath(), `${now}|${key}\n`, 'utf-8');
  } catch {
    // 附通道失败不影响主通道
  }
}

/**
 * 将内存 Map 刷写到各 `<bucket>/<scope>/.lastaccess`（原子写）。
 * 本期由 SP05 定时器调用；这里只提供 API。
 */
export async function flush(): Promise<void> {
  ensureReplayed();
  for (const [key, ts] of memMap) {
    const parsed = parseScopeKey(key);
    if (!parsed) continue;
    const dir = scopeDir(parsed.bucket, parsed.scope);
    try {
      // 仅当 scope 目录存在时才写 lastaccess，避免为已被清理的 scope 重建空目录
      if (!fs.existsSync(dir)) continue;
      const target = path.join(dir, LASTACCESS_FILE);
      const tmp = target + '.tmp';
      fs.writeFileSync(tmp, String(ts), 'utf-8');
      try { fs.renameSync(tmp, target); } catch {
        fs.copyFileSync(tmp, target);
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
    } catch {
      // 单 scope 失败不影响其它
    }
  }
}

/**
 * 获取某 scope 的最新访问时间戳（内存 > .lastaccess > access.log 回放）。
 */
export async function getMaxTimestamp(bucket: CacheBucket, scope: string): Promise<number> {
  ensureReplayed();
  const key = makeScopeKey(bucket, scope);
  const mem = memMap.get(key);
  if (typeof mem === 'number') return mem;
  try {
    const la = path.join(scopeDir(bucket, scope), LASTACCESS_FILE);
    if (fs.existsSync(la)) {
      const n = Number(fs.readFileSync(la, 'utf-8').trim());
      if (Number.isFinite(n)) return n;
    }
  } catch {
    // ignore
  }
  return 0;
}

/**
 * 压缩 access.log：每个 scope 仅保留最大时间戳的一行。
 *
 * - 先把内存 Map 与磁盘 access.log 合并（取最大）
 * - 原子重写 access.log：tmp + rename
 * - 内存 Map 保持不变
 */
export async function compact(): Promise<void> {
  ensureReplayed();

  const merged = new Map<ScopeKey, number>(memMap);
  const p = accessLogPath();
  if (fs.existsSync(p)) {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line) continue;
        const sep = line.indexOf('|');
        if (sep <= 0) continue;
        const ts = Number(line.slice(0, sep));
        const key = line.slice(sep + 1);
        if (!Number.isFinite(ts) || !key) continue;
        const prev = merged.get(key) ?? 0;
        if (ts > prev) merged.set(key, ts);
      }
    } catch {
      // ignore
    }
  }

  const lines: string[] = [];
  for (const [key, ts] of merged) {
    lines.push(`${ts}|${key}`);
  }
  const body = lines.length > 0 ? lines.join('\n') + '\n' : '';

  try {
    fs.mkdirSync(globalRoot(), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, body, 'utf-8');
    try { fs.renameSync(tmp, p); } catch {
      fs.copyFileSync(tmp, p);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  } catch {
    // compact 失败保持旧文件
  }
}

/** 测试用：清空内存 Map 并强制下次重放 */
export function _resetForTest(): void {
  memMap.clear();
  replayed = false;
}

/** 测试 / CLI 诊断：返回内存 Map 副本 */
export function snapshot(): Map<ScopeKey, number> {
  ensureReplayed();
  return new Map(memMap);
}
