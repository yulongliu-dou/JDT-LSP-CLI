/**
 * classFileContents 兜底 Provider
 *
 * 当 JDK / sources-jar / 反编译均失败时，通过 JDT 原生 `java/classFileContents`
 * 请求拉取类的文本内容，写入全局缓存：
 *   `~/.lsp-cache/global/class-file-contents/<hash>/<fqcn-path>.java`
 *
 * 参见：[SP01 子计划 Task 1.6](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getLspCacheRoot } from '../platform/pathUtils';

/**
 * LSP 连接对拉取文本的最小接口，避免本模块依赖具体 LspConnectionManager。
 */
export interface ClassFileContentsFetcher {
  getClassFileContents(uri: string): Promise<string>;
}

export interface ClassFileContentsCtx {
  uri: string;
  fqcn: string;
  fetcher: ClassFileContentsFetcher;
}

/**
 * 计算 uri 的 SHA1 前 8 位作为子目录名
 */
function hashUri(uri: string): string {
  return crypto.createHash('sha1').update(uri, 'utf8').digest('hex').slice(0, 8);
}

function fqcnToRelPath(fqcn: string): string {
  if (!fqcn) return 'Unknown.java';
  return fqcn.replace(/\./g, '/') + '.java';
}

/**
 * 拉取并写入缓存。
 *
 * @returns 缓存文件绝对路径；失败（请求异常/空内容）返回 null
 */
export async function get(ctx: ClassFileContentsCtx): Promise<string | null> {
  if (!ctx?.uri || !ctx.fetcher) return null;
  let text: string;
  try {
    text = await ctx.fetcher.getClassFileContents(ctx.uri);
  } catch {
    return null;
  }
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }

  const hash = hashUri(ctx.uri);
  const rel = fqcnToRelPath(ctx.fqcn || 'Unknown');
  const cachePath = path.join(
    getLspCacheRoot(),
    'global',
    'class-file-contents',
    hash,
    rel
  );

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = cachePath + '.tmp';
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, cachePath);
  } catch {
    return null;
  }

  return cachePath;
}
