/**
 * URI 重写层
 *
 * 把 LSP 返回的 `jdt://...` 位置 / 调用项替换为真实 `file://` 路径：
 * - `file:...` 开头 → 零开销透传
 * - `jdt:...` → 通过 `LibraryClassLocator.resolve` 解析
 * - 配置 `libraryResolveEnabled=false` → 透传（等价于 `--no-library-resolve`）
 * - Locator 未注册 / resolve 失败 → 返回原值（保证现有用例无回归）
 *
 * 外部集成模式：
 *   1) 应用启动或守护进程初始化时调用 `setLibraryLocator(locator)`
 *   2) 各命令处理器直接调 `rewriteLocation` / `rewriteCallItem` / `rewriteLocations`
 *
 * 参见：[SP02 子计划 Task 2.6](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-%E7%BC%93%E5%AD%98%E4%B8%8EURI%E9%87%8D%E5%86%99_b2c3d4e5.md)
 */

import type { Location, CallHierarchyItem, Range } from '../core/types';
import type { LibraryClassLocator } from './core/libraryClassLocator';
import type { LibraryProviderConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { load as loadDaemonConfig } from './daemonConfigStore';

let activeLocator: LibraryClassLocator | null = null;
let cachedConfig: LibraryProviderConfig | null = null;
let cliOverrideEnabled: boolean | null = null;

/** 注入当前上下文的 LibraryClassLocator；传 null 代表禁用。 */
export function setLibraryLocator(locator: LibraryClassLocator | null): void {
  activeLocator = locator;
}

/** 清空内部配置缓存（下次 rewrite 时重新加载） */
export function refreshRewriterConfig(): void {
  cachedConfig = null;
}

/**
 * CLI `--no-library-resolve` 运行时覆盖。
 * - `true`  : 强制启用
 * - `false` : 强制透传
 * - `null`  : 回退到配置文件
 */
export function setCliOverrideEnabled(enabled: boolean | null): void {
  cliOverrideEnabled = enabled;
}

function getConfig(): LibraryProviderConfig {
  if (!cachedConfig) {
    try {
      cachedConfig = loadDaemonConfig();
    } catch {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  }
  return cachedConfig;
}

function resolveEnabled(): boolean {
  if (cliOverrideEnabled !== null) return cliOverrideEnabled;
  return getConfig().libraryResolveEnabled;
}

function isJdtUri(uri: string | undefined | null): boolean {
  return typeof uri === 'string' && uri.startsWith('jdt:');
}

/**
 * 重写单个 Location。失败静默返回原值。
 */
export async function rewriteLocation(loc: Location | null | undefined): Promise<Location> {
  if (!loc || !loc.uri) return loc as Location;
  if (!isJdtUri(loc.uri)) return loc;
  if (!resolveEnabled()) return loc;
  const locator = activeLocator;
  if (!locator) return loc;

  try {
    const resolved = await locator.resolve(loc.uri, loc.range as Range);
    if (!resolved) return loc;
    // 将扩展字段合并到 Location（TypeScript 接口不含，运行时透传）
    const enriched = {
      uri: resolved.uri,
      range: resolved.range,
      originalUri: resolved.originalUri,
      originalRange: resolved.originalRange,
      source: resolved.source,
      lineMapping: resolved.lineMapping,
      note: resolved.note,
      lockWaitMs: resolved.lockWaitMs,
    } as Location & Record<string, unknown>;
    return enriched;
  } catch {
    return loc;
  }
}

/**
 * 批量重写 Location 数组。保持原顺序；单条失败不影响其它。
 */
export async function rewriteLocations(arr: Location[] | null | undefined): Promise<Location[]> {
  if (!arr || arr.length === 0) return (arr ?? []) as Location[];
  if (!resolveEnabled()) return arr;
  // 串行以保证 withLock 不被并发撑开（同一 scope 仍会串行等锁）
  const out: Location[] = [];
  for (const loc of arr) {
    out.push(await rewriteLocation(loc));
  }
  return out;
}

/**
 * 重写 CallHierarchyItem。保留原有 name/kind/detail 等字段，仅替换 uri/range 并合并扩展字段。
 */
export async function rewriteCallItem(
  item: CallHierarchyItem | null | undefined
): Promise<CallHierarchyItem> {
  if (!item || !item.uri) return item as CallHierarchyItem;
  if (!isJdtUri(item.uri)) return item;
  if (!resolveEnabled()) return item;
  const locator = activeLocator;
  if (!locator) return item;

  try {
    const resolved = await locator.resolve(item.uri, item.range as Range);
    if (!resolved) return item;
    const enriched = {
      ...item,
      uri: resolved.uri,
      range: resolved.range,
      // selectionRange 落在同文件下，跟随 range 同步（近似最保守策略）
      selectionRange: item.selectionRange || resolved.range,
      originalUri: resolved.originalUri,
      originalRange: resolved.originalRange,
      source: resolved.source,
      lineMapping: resolved.lineMapping,
      note: resolved.note,
      lockWaitMs: resolved.lockWaitMs,
    } as CallHierarchyItem & Record<string, unknown>;
    return enriched;
  } catch {
    return item;
  }
}

/**
 * 测试辅助：重置全部内部状态。
 */
export function _resetForTest(): void {
  activeLocator = null;
  cachedConfig = null;
  cliOverrideEnabled = null;
}
