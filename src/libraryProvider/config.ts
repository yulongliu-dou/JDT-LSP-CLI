/**
 * libraryProvider 配置
 *
 * 维护源码下载策略、缓存 TTL、反编译器等运行时配置。
 * 实际持久化由 `daemonConfigStore.ts` 负责读写 `~/.lsp-cache/daemon-config.json`。
 *
 * 参见：[SP01 子计划 Task 1.9](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

/**
 * 源码下载模式：
 * - 'mvn'    : 使用本地 `mvn` 命令拉取 sources jar（SP04）
 * - 'http'   : 使用自研 HTTP 下载器（本期非目标，留接口）
 * - 'none'   : 不主动下载，仅查本地缓存
 */
export type SourceDownloadMode = 'mvn' | 'http' | 'none';

/** 反编译器选择 */
export type DecompilerKind = 'vineflower' | 'cfr' | 'none';

export interface LibraryProviderConfig {
  /** 是否启用 jar 类解析（总开关） */
  libraryResolveEnabled: boolean;
  /** 源码下载模式 */
  sourceDownloadMode: SourceDownloadMode;
  /** 缓存 TTL（天） */
  cacheTtlDays: number;
  /** 反编译器 */
  decompiler: DecompilerKind;
  /** 是否在 daemon 启动时预取直接依赖 sources jar（SP05） */
  warmupEnabled: boolean;
  /** 自动伸缩运行时配置（可热更新） */
  autoScaling?: {
    enabled?: boolean;
    maxProjects?: number;
    minProjects?: number;
  };
}

export const DEFAULT_CONFIG: LibraryProviderConfig = {
  libraryResolveEnabled: true,
  sourceDownloadMode: 'mvn',
  cacheTtlDays: 7,
  decompiler: 'vineflower',
  warmupEnabled: true,
};

/**
 * 合并局部配置到默认值
 */
export function mergeConfig(
  partial: Partial<LibraryProviderConfig> | undefined | null
): LibraryProviderConfig {
  if (!partial) return { ...DEFAULT_CONFIG };
  const merged: LibraryProviderConfig = { ...DEFAULT_CONFIG };
  if (typeof partial.libraryResolveEnabled === 'boolean') {
    merged.libraryResolveEnabled = partial.libraryResolveEnabled;
  }
  if (partial.sourceDownloadMode === 'mvn' || partial.sourceDownloadMode === 'http' || partial.sourceDownloadMode === 'none') {
    merged.sourceDownloadMode = partial.sourceDownloadMode;
  }
  if (typeof partial.cacheTtlDays === 'number' && partial.cacheTtlDays > 0) {
    merged.cacheTtlDays = Math.floor(partial.cacheTtlDays);
  }
  if (partial.decompiler === 'vineflower' || partial.decompiler === 'cfr' || partial.decompiler === 'none') {
    merged.decompiler = partial.decompiler;
  }
  if (typeof partial.warmupEnabled === 'boolean') {
    merged.warmupEnabled = partial.warmupEnabled;
  }
  if (partial.autoScaling && typeof partial.autoScaling === 'object') {
    merged.autoScaling = {
      ...merged.autoScaling,
      ...partial.autoScaling,
    };
  }
  return merged;
}
