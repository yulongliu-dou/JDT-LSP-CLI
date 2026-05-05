/**
 * libraryProvider 核心类型定义
 *
 * 职责：
 * - 定义 GAV（Maven 坐标）
 * - 定义 ResolvedLibraryLocation（解析结果）
 * - 定义 SourceProvider / DependencyResolver 扩展点接口
 *
 * 参见：[SP01 子计划 Task 1.2](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import type { Range } from 'vscode-languageserver-types';

/**
 * Maven 坐标
 */
export interface GAV {
  groupId: string;
  artifactId: string;
  version: string;
  /** 可选分类器，例如 sources / javadoc */
  classifier?: string;
}

/**
 * 源码来源分类
 *
 * - workspace：工作区内的源码（无需解析）
 * - jdk-src：来自 $JAVA_HOME/lib/src.zip
 * - sources-jar：来自 Maven sources jar
 * - decompiled：反编译产物（Vineflower / CFR 等）
 * - class-file-contents：JDT 原生 `java/classFileContents` 返回
 */
export type LibrarySource =
  | 'workspace'
  | 'jdk-src'
  | 'sources-jar'
  | 'decompiled'
  | 'class-file-contents';

/**
 * 行号映射精度
 *
 * - exact：源码精确对齐（jdk-src / sources-jar）
 * - best-effort：反编译的 lineMap 尽力而为
 * - n/a：classFileContents 兜底无法对齐
 */
export type LineMapping = 'exact' | 'best-effort' | 'n/a';

/**
 * 解析后的 Library 位置
 *
 * 重写后的 uri 必须为 `file://` 形式，range 必须为重写后文件内的行号。
 */
export interface ResolvedLibraryLocation {
  /** 重写后的文件 URI（file://） */
  uri: string;
  /** 重写后的范围 */
  range: Range;
  /** 源码来源 */
  source: LibrarySource;
  /** 原始 jdt:// URI */
  originalUri: string;
  /** 原始 range（LSP 返回的位置，可能与重写后不同） */
  originalRange: Range;
  /** 备注（例如 fallback 原因） */
  note?: string;
  /** 锁等待耗时（ms），命中缓存时为 0 */
  lockWaitMs?: number;
  /** 行号映射精度 */
  lineMapping?: LineMapping;
}

/**
 * SourceProvider 扩展点
 *
 * 每个 Provider 接收上下文（jdt:// 解析结果 + 项目信息），尝试产出源码文件路径。
 * 返回 null 表示本 Provider 不适用，调用方应继续向下走。
 */
export interface SourceProvider {
  /**
   * 尝试获取源码
   * @param ctx 依赖上下文（由具体 Provider 约定）
   * @returns 源码文件的绝对路径，失败返回 null
   */
  fetch(ctx: unknown): Promise<string | null>;
}

/**
 * jdt:// URI 解析结果
 */
export interface ParsedJdtUri {
  /** container，例如 `/path/to/foo.jar` 或 `jrt-fs.jar` 段 */
  container: string;
  /** 全限定类名，例如 `java.util.List` */
  fqcn: string;
}
