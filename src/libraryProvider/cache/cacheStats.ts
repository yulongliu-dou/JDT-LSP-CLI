/**
 * 缓存统计工具（SP05 提取）
 *
 * 从 CLI cache stats 命令中抽取，供 daemon HTTP 端点复用。
 * 统计 `~/.lsp-cache/global/` 下各 bucket 的大小、scope 数、访问时间。
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLspCacheRoot } from '../platform/pathUtils';

export interface BucketStats {
  bytes: number;
  scopeCount: number;
  oldestAccess: number | null;
  newestAccess: number | null;
}

export interface CacheStats {
  totalBytes: number;
  buckets: Record<string, BucketStats>;
}

function dirStats(dir: string): { size: number; oldestTs: number | null; newestTs: number | null } {
  let size = 0;
  let oldestTs: number | null = null;
  let newestTs: number | null = null;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile()) {
        try {
          const s = fs.statSync(fullPath);
          size += s.size;
          const mtime = s.mtimeMs;
          if (oldestTs === null || mtime < oldestTs) oldestTs = mtime;
          if (newestTs === null || mtime > newestTs) newestTs = mtime;
        } catch { /* ignore */ }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const sub = dirStats(fullPath);
        size += sub.size;
        if (sub.oldestTs !== null) {
          oldestTs = oldestTs === null ? sub.oldestTs : Math.min(oldestTs, sub.oldestTs);
        }
        if (sub.newestTs !== null) {
          newestTs = newestTs === null ? sub.newestTs : Math.max(newestTs, sub.newestTs);
        }
      }
    }
  } catch {
    // ignore
  }

  return { size, oldestTs, newestTs };
}

/**
 * 收集全局缓存统计信息
 */
export function collectStats(): CacheStats {
  const stats: CacheStats = {
    totalBytes: 0,
    buckets: {},
  };

  const globalDir = path.join(getLspCacheRoot(), 'global');
  if (!fs.existsSync(globalDir)) return stats;

  let bucketNames: string[];
  try {
    bucketNames = fs.readdirSync(globalDir).filter(n => {
      const p = path.join(globalDir, n);
      return fs.statSync(p).isDirectory() && !n.startsWith('.');
    });
  } catch {
    return stats;
  }

  for (const bucket of bucketNames) {
    const bucketDir = path.join(globalDir, bucket);
    const bucketStats: BucketStats = { bytes: 0, scopeCount: 0, oldestAccess: null, newestAccess: null };

    try {
      const scopes = fs.readdirSync(bucketDir).filter(n => {
        const p = path.join(bucketDir, n);
        return fs.statSync(p).isDirectory();
      });

      for (const scope of scopes) {
        const scopeDir = path.join(bucketDir, scope);
        const { size, oldestTs, newestTs } = dirStats(scopeDir);
        bucketStats.bytes += size;
        bucketStats.scopeCount++;
        if (oldestTs !== null) {
          bucketStats.oldestAccess = bucketStats.oldestAccess === null
            ? oldestTs
            : Math.min(bucketStats.oldestAccess, oldestTs);
        }
        if (newestTs !== null) {
          bucketStats.newestAccess = bucketStats.newestAccess === null
            ? newestTs
            : Math.max(bucketStats.newestAccess, newestTs);
        }
      }
    } catch {
      // ignore
    }

    stats.buckets[bucket] = bucketStats;
    stats.totalBytes += bucketStats.bytes;
  }

  return stats;
}
