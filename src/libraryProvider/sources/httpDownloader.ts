/**
 * HTTP 下载器接口（本期仅预留）
 *
 * SP04 非目标：自研 Maven HTTP 下载器。
 * 本期所有调用均抛 `NotImplementedError`，降级到 `downloadMode=off`。
 *
 * 参见：[SP04 子计划 Task 4.2](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import type { GAV } from '../core/types';

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented`);
    this.name = 'NotImplementedError';
  }
}

/**
 * 通过 HTTP 下载 sources jar（本期不实现）
 */
export async function downloadSourcesJar(_gav: GAV): Promise<string | null> {
  throw new NotImplementedError('HTTP downloader');
}
