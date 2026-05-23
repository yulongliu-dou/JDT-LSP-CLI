/**
 * Cache 命令处理
 *
 * 负责：
 * - cache stats：统计 ~/.lsp-cache/global/ 总大小、各 bucket 大小、scope 数
 * - cache clean：按 TTL 或全量清除
 * - cache warm：预取项目直接依赖的 sources jar
 *
 * 参见：[SP04 子计划 Task 4.6](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLspCacheRoot } from '../../libraryProvider/platform/pathUtils';
import { load as loadDaemonConfig } from '../../libraryProvider/daemonConfigStore';
import { cleanStale, cleanAll } from '../../libraryProvider/cache/cacheCleaner';
import { listDirectDeps } from '../../libraryProvider/resolvers/mavenDependencyResolver';
import { runDependencySources } from '../../libraryProvider/sources/mvnRunner';
import { validateCacheStatsCommand, validateCacheCleanCommand, validateCacheWarmCommand } from '../utils/paramValidator';
import { outputResult } from '../utils/outputHandler';

// ── Help ──────────────────────────────────────────────────────────────────────

const CACHE_STATS_HELP = `
Usage: jls cache stats [options]

显示缓存统计信息（总大小、各 bucket 大小、scope 数量）。

Options:
  --format <fmt>   输出格式：table | json（默认 table）
  -h, --help       显示帮助

Examples:
  jls cache stats
  jls cache stats --format json
`;

const CACHE_CLEAN_HELP = `
Usage: jls cache clean [options]

清理缓存条目。

Options:
  --stale                仅清理超过 TTL 的条目
  --all                  删除所有缓存条目
  --cache-ttl-days <n>   覆盖 TTL 天数
  -h, --help             显示帮助

Examples:
  jls cache clean --stale
  jls cache clean --stale --cache-ttl-days 3
  jls cache clean --all
`;

const CACHE_WARM_HELP = `
Usage: jls cache warm [options]

预下载项目的直接依赖 sources jar 到缓存。

Options:
  --project <path>   项目根路径
  --timeout <ms>     单构件超时毫秒（默认 60000）
  -h, --help         显示帮助

Examples:
  jls cache warm
  jls cache warm --project /path/to/project
`;

// ── Command ───────────────────────────────────────────────────────────────────

const KB = 1024;
const MB = KB * 1024;

interface CacheStats {
  totalBytes: number;
  buckets: Record<string, { bytes: number; scopeCount: number; oldestAccess: number | null; newestAccess: number | null }>;
}

/**
 * 递归统计目录大小 + scope 数
 */
function collectStats(dir: string): CacheStats {
  const stats: CacheStats = {
    totalBytes: 0,
    buckets: {},
  };

  const globalDir = path.join(getLspCacheRoot(), 'global');
  if (!fs.existsSync(globalDir)) return stats;

  const bucketNames = fs.readdirSync(globalDir).filter(n => {
    const p = path.join(globalDir, n);
    return fs.statSync(p).isDirectory() && n !== '.lock';
  });

  for (const bucket of bucketNames) {
    const bucketDir = path.join(globalDir, bucket);
    const bucketStats = { bytes: 0, scopeCount: 0, oldestAccess: null as number | null, newestAccess: null as number | null };

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
      } else if (entry.isDirectory()) {
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

function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatTs(ts: number | null): string {
  if (ts === null) return 'n/a';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function registerCache(program: Command): void {
  const cacheCmd = program
    .command('cache')
    .description('管理源码缓存和 Jar 解析。');

  // cache stats
  cacheCmd
    .command('stats')
    .description('显示缓存统计信息。')
    .configureHelp({ formatHelp: () => CACHE_STATS_HELP })
    .option('--format <fmt>', 'Output format: table|json', 'table')
    .action((cmdOpts) => {
      const opts = program.opts();
      const validationError = validateCacheStatsCommand(cmdOpts);
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }

      const stats = collectStats(getLspCacheRoot());

      if (cmdOpts.format === 'json') {
        console.log(JSON.stringify({
          totalBytes: stats.totalBytes,
          totalFormatted: formatBytes(stats.totalBytes),
          buckets: Object.fromEntries(
            Object.entries(stats.buckets).map(([name, b]) => [
              name,
              {
                bytes: b.bytes,
                formatted: formatBytes(b.bytes),
                scopeCount: b.scopeCount,
                oldestAccess: formatTs(b.oldestAccess),
                newestAccess: formatTs(b.newestAccess),
              },
            ])
          ),
        }, null, 2));
      } else {
        console.log(`Cache root: ${path.join(getLspCacheRoot(), 'global')}`);
        console.log(`Total: ${formatBytes(stats.totalBytes)}`);
        console.log('');
        console.log('Bucket         Size       Scopes  Oldest        Newest');
        console.log('-------------  ---------  ------  ------------  ------------');
        for (const [name, b] of Object.entries(stats.buckets)) {
          console.log(
            `${name.padEnd(14)} ${formatBytes(b.bytes).padStart(9)}  ${String(b.scopeCount).padStart(6)}  ${formatTs(b.oldestAccess).padEnd(12)}  ${formatTs(b.newestAccess)}`
          );
        }
      }
    });

  // cache clean
  cacheCmd
    .command('clean')
    .description('清理缓存条目。')
    .configureHelp({ formatHelp: () => CACHE_CLEAN_HELP })
    .option('--stale', 'Clean only entries older than cache-ttl-days')
    .option('--all', 'Remove all cache entries')
    .option('--cache-ttl-days <n>', 'Override TTL days', (v: string) => parseInt(v, 10))
    .action(async (cmdOpts) => {
      const opts = program.opts();
      const validationError = validateCacheCleanCommand(cmdOpts);
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }

      if (cmdOpts.all) {
        await cleanAll();
        console.log('All cache entries removed.');
        return;
      }

      if (cmdOpts.stale || !cmdOpts.all) {
        const config = loadDaemonConfig();
        const ttlDays = cmdOpts.cacheTtlDays ?? config.cacheTtlDays;
        if (ttlDays <= 0) {
          console.log('Cache TTL is 0, no entries cleaned. Use --cache-ttl-days to override.');
          return;
        }
        const report = await cleanStale(ttlDays);
        console.log(`Cleaned ${report.removed} stale scope(s) of ${report.scanned} scanned (TTL: ${ttlDays} day(s)).`);
      }
    });

  // cache warm
  cacheCmd
    .command('warm')
    .description('预下载依赖 sources jar。')
    .configureHelp({ formatHelp: () => CACHE_WARM_HELP })
    .option('--project <path>', 'Project root path', process.cwd())
    .option('--timeout <ms>', 'Timeout per artifact in ms', '60000')
    .action(async (cmdOpts) => {
      const opts = program.opts();
      const validationError = validateCacheWarmCommand(cmdOpts);
      if (validationError) {
        outputResult(validationError, undefined, opts.jsonCompact, opts.output);
        return;
      }

      const projectRoot = path.resolve(cmdOpts.project);
      const deps = await listDirectDeps(projectRoot);

      if (deps.length === 0) {
        console.log('No direct dependencies found in pom.xml.');
        return;
      }

      console.log(`Found ${deps.length} direct dependencies. Downloading sources...`);
      let ok = 0;
      let fail = 0;

      for (const gav of deps) {
        const label = `${gav.groupId}:${gav.artifactId}:${gav.version}`;
        try {
          const result = await runDependencySources({
            gavs: [gav],
            workspaceRoot: projectRoot,
            excludeTransitive: true,
            timeoutMs: parseInt(cmdOpts.timeout, 10),
          });
          if (result.ok) {
            console.log(`  ✓ ${label}`);
            ok++;
          } else {
            console.log(`  ✗ ${label} — ${result.stderr.slice(0, 120)}`);
            fail++;
          }
        } catch (err: any) {
          console.log(`  ✗ ${label} — ${err?.message || err}`);
          fail++;
        }
      }

      console.log(`\nDone: ${ok} succeeded, ${fail} failed.`);
    });
}
