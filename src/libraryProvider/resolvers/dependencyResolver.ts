/**
 * DependencyResolver 扩展点
 *
 * 后续可扩展：Maven / Gradle / 其他构建工具。
 * 本期仅实现 Maven 的最小版本（`jarToGAV`）。
 *
 * 参见：[SP01 子计划 Task 1.1](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import type { GAV } from '../core/types';

export interface DependencyResolver {
  /** 构建工具标识（'maven' / 'gradle' / ...） */
  readonly kind: string;

  /**
   * 从 jar 绝对路径反解 GAV
   * @param jarPath 本地 jar 绝对路径
   * @returns 成功返回 GAV，失败返回 null
   */
  jarToGAV(jarPath: string): GAV | null;

  /**
   * 请求下载 sources jar（SP04 才实现）
   * @returns sources jar 本地路径，或 null
   */
  fetchSourcesJar?(gav: GAV): Promise<string | null>;
}
