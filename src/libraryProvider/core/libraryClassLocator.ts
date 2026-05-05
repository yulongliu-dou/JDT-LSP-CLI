/**
 * LibraryClassLocator：Library 类源码解析总入口
 *
 * 串联各 Provider（按优先级）：
 * 0) JdkSourceProvider         ——  JDK 快速通道
 * 1) SourceJarProvider          ——  SP04 sources jar 优先命中
 * 2) DecompileProvider         ——  SP03 Vineflower 反编译
 * 3) classFileContents 兜底    ——  JDT 原生
 *
 * 注：分支 1（sources-jar）已由 SP04 实现。
 *
 * SP02 起：
 * - 所有落地走 globalCache（`~/.lsp-cache/global/`）
 * - workspace 侧通过 workspaceLink 建立 symlink/junction/拷贝，保证 IDE 可见
 * - accessTracker 记录命中；lockWaitMs 传出
 *
 * 返回 `ResolvedLibraryLocation`，其中 `uri` 为重写后的 file:// URI。
 *
 * 参见：
 * - [SP01 子计划 Task 1.7](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 * - [SP02 子计划 Task 2.5](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-%E7%BC%93%E5%AD%98%E4%B8%8EURI%E9%87%8D%E5%86%99_b2c3d4e5.md)
 * - [SP03 子计划 Task 3.5](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower%E5%8F%8D%E7%BC%96%E8%AF%91_c3d4e5f6.md)
 */

import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { Range } from 'vscode-languageserver-types';
import { parse as parseJdtUri } from './jdtUriParser';
import { isJdk } from '../resolvers/jdkRuntimeDetector';
import * as jdkSourceProvider from '../sources/jdkSourceProvider';
import type { ClassFileContentsFetcher } from '../fallback/classFileContentsProvider';
import { toFileUrl } from '../platform/pathUtils';
import type { ResolvedLibraryLocation, LibrarySource, LineMapping } from './types';
import * as globalCache from '../cache/globalCache';
import * as accessTracker from '../cache/accessTracker';
import { linkScope } from '../cache/workspaceLink';
import { decompile as decompileClass } from '../decompile/decompileProvider';
import type { LibraryProviderConfig, DecompilerKind } from '../config';
import { jarToGAV, resolveLocalRepo } from '../resolvers/mavenDependencyResolver';
import { fetchSourceJar, extractFqcn } from '../sources/sourceJarProvider';

export interface LibraryClassLocatorDeps {
  /** classFileContents 底层请求函数（通常由 LspConnectionManager 提供） */
  fetcher: ClassFileContentsFetcher;
  /** 可选：工作区根目录，用于建立 `.lsp-cache/jars/` 可见性 */
  workspaceRoot?: string;
  /** 可选：JAVA_HOME */
  javaHome?: string;
  /** 可选：Java 主版本 */
  javaMajor?: number;
  /** 可选：libraryProvider 配置（影响反编译器选择等） */
  config?: LibraryProviderConfig;
  /** 可选：降级 / 非致命错误回调（SP05 daemon 模式收集 warnings） */
  onWarning?: (msg: string) => void;
}

function hashUri(uri: string): string {
  return crypto.createHash('sha1').update(uri, 'utf8').digest('hex').slice(0, 8);
}

/**
 * 尝试从 jdt:// container 还原 jar 文件系统路径（尽力而为）。
 *
 * JDT LS 的 container 格式多样：
 * - 直接绝对路径：`/C:/Users/.../foo.jar` 或 `C:\...\foo.jar`
 * - URI 编码路径：对特殊字符编码后的绝对路径
 * - Maven 本地仓库路径：`/groupId/artifactId/version/jar`（hash 过）
 *
 * 返回存在的 jar 文件路径；无法解析或不存在返回 null。
 */
function resolveJarPath(container: string): string | null {
  if (!container) return null;

  // 尝试候选解码
  const candidates = [container];
  try { candidates.push(decodeURIComponent(container)); } catch { /* ignore */ }

  for (const c of candidates) {
    // 跳过明确的非文件容器（如 jrt-fs.jar 虚拟容器、网络 URL）
    if (c.startsWith('http://') || c.startsWith('https://') || c.startsWith('jrt:')) {
      continue;
    }
    // 尝试当作文件路径
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return path.resolve(c);
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/** 将 scope 片段中的非法字符替换为 `_`，避免路径跨目录风险 */
function sanitizeScopeSegment(seg: string): string {
  // 只保留字母数字、连字符、下划线、点
  return seg.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}

export class LibraryClassLocator {
  constructor(private readonly deps: LibraryClassLocatorDeps) {}

  /**
   * 解析 jdt:// URI。返回 null 表示本 URI 非 jdt:// 或解析彻底失败。
   */
  async resolve(uri: string, range: Range): Promise<ResolvedLibraryLocation | null> {
    const parsed = parseJdtUri(uri);
    if (!parsed) return null;

    // 用 uri-hash 作为跨分支的统一锁，保证同一 URI 解析串行化
    const lockScope = hashUri(uri);
    const { result, waitMs } = await globalCache.withLock(
      'class-file-contents',
      lockScope,
      async () => this.resolveUnderLock(uri, parsed.fqcn, parsed.container, range)
    );
    if (!result) return null;
    return {
      ...result,
      originalUri: uri,
      originalRange: range,
      lockWaitMs: waitMs,
    };
  }

  private async resolveUnderLock(
    uri: string,
    fqcn: string,
    container: string,
    range: Range
  ): Promise<Omit<ResolvedLibraryLocation, 'originalUri' | 'originalRange' | 'lockWaitMs'> | null> {
    // ----- 分支 0：JDK 快速通道 -----
    if (isJdk(container, fqcn)) {
      const jdkHit = await this.tryJdk(fqcn, range);
      if (jdkHit) return jdkHit;
      // JDK 命中但抽取失败 → 继续走兜底
    }

    // ----- 分支 1：Sources Jar（SP04）优先级高于反编译 -----
    const sourceDownloadMode = this.deps.config?.sourceDownloadMode ?? 'mvn';
    if (sourceDownloadMode !== 'none') {
      const sourcesHit = await this.trySourceJar(container, fqcn, range);
      if (sourcesHit) return sourcesHit;
    }

    // ----- 分支 2：Vineflower 反编译（SP03） -----
    const decompiler = this.deps.config?.decompiler ?? 'vineflower';
    if (decompiler === 'vineflower') {
      const decompiledHit = await this.tryDecompile(container, fqcn, range);
      if (decompiledHit) return decompiledHit;
    }
    // decompiler === 'cfr' / 'none' → 跳过反编译，直接走 classFileContents
    // 对 'none' 模式的 classFileContents 兜底追加说明 note
    const disableNote = decompiler === 'none' ? 'Decompiler disabled by config. Showing fallback classFileContents.' : undefined;

    // ----- 分支 3：classFileContents 兜底 -----
    const cfcHit = await this.tryClassFileContents(uri, fqcn, range);
    if (cfcHit) {
      if (disableNote) {
        cfcHit.note = disableNote;
      }
      return cfcHit;
    }

    return null;
  }

  /** 尝试 JDK 源码 */
  private async tryJdk(fqcn: string, range: Range): Promise<Omit<ResolvedLibraryLocation, 'originalUri' | 'originalRange' | 'lockWaitMs'> | null> {
    const jdk = await jdkSourceProvider.fetch({
      fqcn,
      javaHome: this.deps.javaHome,
      javaMajor: this.deps.javaMajor,
    });
    if (!jdk) return null;

    const majorLabel = jdk.javaMajor > 0 ? String(jdk.javaMajor) : 'unknown';
    const scope = `${majorLabel}/${jdk.module}`;
    const globalScopeDir = globalCache.scopeDir('jdk', scope);
    const effectivePath = await this.materializeLink('jdk', scope, globalScopeDir, jdk.cachePath);
    accessTracker.touch('jdk', scope);

    return {
      uri: toFileUrl(effectivePath),
      range,
      source: 'jdk-src' as LibrarySource,
      lineMapping: 'exact' as LineMapping,
    };
  }

  /**
   * 尝试 Sources Jar（SP04）
   *
   * 从 container 解析 GAV，查找 / 下载 sources jar，提取 fqcn 源码。
   * scope 使用 GAV 形式，可读性强。
   */
  private async trySourceJar(
    container: string,
    fqcn: string,
    range: Range
  ): Promise<Omit<ResolvedLibraryLocation, 'originalUri' | 'originalRange' | 'lockWaitMs'> | null> {
    const jarPath = resolveJarPath(container);
    if (!jarPath) return null;

    const gav = jarToGAV(jarPath);
    if (!gav) return null;

    const downloadMode = this.deps.config?.sourceDownloadMode ?? 'mvn';
    const sourceJar = await fetchSourceJar(gav, {
      downloadMode,
      workspaceRoot: this.deps.workspaceRoot,
    });
    if (!sourceJar) return null;

    // scope = GAV 格式 (groupId/artifactId/version)
    const scope = `${sanitizeScopeSegment(gav.groupId)}/${sanitizeScopeSegment(gav.artifactId)}/${sanitizeScopeSegment(gav.version)}`;
    const globalScopeDir = globalCache.scopeDir('sources', scope);

    const filePath = await extractFqcn(sourceJar, fqcn, globalScopeDir);
    if (!filePath) return null;

    const effectivePath = await this.materializeLink(
      'sources',
      scope,
      globalScopeDir,
      filePath
    );
    accessTracker.touch('sources', scope);

    return {
      uri: toFileUrl(effectivePath),
      range,
      source: 'sources-jar' as LibrarySource,
      lineMapping: 'exact' as LineMapping,
    };
  }

  /**
   * 尝试 Vineflower 反编译（SP03）
   *
   * 从 container 尝试还原 jar 路径，调用 decompileProvider 全量反编译。
   * scope 推导：优先用 jar basename + hash（可读 + 唯一）。
   */
  private async tryDecompile(
    container: string,
    fqcn: string,
    range: Range
  ): Promise<Omit<ResolvedLibraryLocation, 'originalUri' | 'originalRange' | 'lockWaitMs'> | null> {
    const jarPath = resolveJarPath(container);
    if (!jarPath) return null;

    // scope 复用容器指纹：jar 名 + SHA1 前 8
    const jarName = path.basename(jarPath, path.extname(jarPath));
    const scope = `${sanitizeScopeSegment(jarName)}-${hashUri(container).slice(0, 8)}`;

    const result = await decompileClass({
      jarPath,
      scope,
      fqcn,
    });
    if (!result) return null;

    // 使用 lineMap 将字节码行号映射到反编译产物行号
    const mapped = result.lineMap.translate(range);

    const globalScopeDir = globalCache.scopeDir('decompiled', scope);
    const effectivePath = await this.materializeLink(
      'decompiled',
      scope,
      globalScopeDir,
      result.filePath
    );
    accessTracker.touch('decompiled', scope);

    return {
      uri: toFileUrl(effectivePath),
      range: mapped.range,
      source: 'decompiled' as LibrarySource,
      lineMapping: mapped.quality === 'n/a' ? 'best-effort' : mapped.quality,
      note: 'Decompiled code. Line mapping is approximate. Use method signatures for orientation. Avoid modifying this file.',
    };
  }

  /** 尝试 classFileContents 兜底 */
  private async tryClassFileContents(
    uri: string,
    fqcn: string,
    range: Range
  ): Promise<Omit<ResolvedLibraryLocation, 'originalUri' | 'originalRange' | 'lockWaitMs'> | null> {
    const scope = hashUri(uri);

    // 命中缓存直接复用
    let cachePath = globalCache.lookup('class-file-contents', scope, fqcn);
    if (!cachePath) {
      let text: string;
      try {
        text = await this.deps.fetcher.getClassFileContents(uri);
      } catch {
        return null;
      }
      if (typeof text !== 'string' || text.length === 0) return null;
      cachePath = await globalCache.write('class-file-contents', scope, fqcn, text);
    }

    const globalScopeDir = globalCache.scopeDir('class-file-contents', scope);
    const effectivePath = await this.materializeLink(
      'class-file-contents',
      scope,
      globalScopeDir,
      cachePath
    );
    accessTracker.touch('class-file-contents', scope);

    return {
      uri: toFileUrl(effectivePath),
      range,
      source: 'class-file-contents' as LibrarySource,
      lineMapping: 'n/a' as LineMapping,
      note: 'fallback: java/classFileContents',
    };
  }

  /**
   * 在 workspace 内建立 link/拷贝，返回映射后的文件绝对路径。
   * 未提供 workspaceRoot 时直接回退到全局主本路径。
   */
  private async materializeLink(
    bucket: globalCache.CacheBucket,
    scope: string,
    globalScopeDir: string,
    cachePath: string
  ): Promise<string> {
    if (!this.deps.workspaceRoot) return cachePath;
    try {
      const rel = path.relative(globalScopeDir, cachePath);
      const { linkPath } = await linkScope(
        this.deps.workspaceRoot,
        `${bucket}/${scope}`,
        globalScopeDir
      );
      return path.join(linkPath, rel);
    } catch {
      this.deps.onWarning?.(
        `Symbolic links unavailable for scope ${bucket}/${scope}; falling back to file copies.`
      );
      return cachePath;
    }
  }
}
