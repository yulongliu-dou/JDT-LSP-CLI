/**
 * 跨平台路径工具
 *
 * 封装 `url` 模块的 `pathToFileURL` / `fileURLToPath`，同时额外处理：
 * - Windows 反斜杠 → 正斜杠
 * - 大小写敏感性标记（供后续缓存键使用）
 *
 * 参见：[SP01 子计划 Task 1.10](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import { pathToFileURL, fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';

/**
 * 将本地绝对路径转为 file:// URL 字符串
 */
export function toFileUrl(absPath: string): string {
  return pathToFileURL(absPath).href;
}

/**
 * 将 file:// URL 还原为本地绝对路径
 *
 * 对非 file:// 协议会抛出。调用方应在传入前自行校验。
 */
export function fromFileUrl(url: string): string {
  return fileURLToPath(url);
}

/**
 * 规范化为 POSIX 斜杠（用于 LSP URI 拼接）
 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 平台路径是否大小写敏感
 *
 * Windows / macOS 默认不敏感，Linux 敏感。
 */
export function isCaseSensitivePath(): boolean {
  const platform = os.platform();
  return platform !== 'win32' && platform !== 'darwin';
}

/**
 * 计算路径的"大小写折叠"形式（用于 Windows/macOS 去重）
 */
export function foldCase(p: string): string {
  return isCaseSensitivePath() ? p : p.toLowerCase();
}

/**
 * 平台的用户缓存根目录（~/.lsp-cache）
 */
export function getLspCacheRoot(): string {
  return path.join(os.homedir(), '.lsp-cache');
}
