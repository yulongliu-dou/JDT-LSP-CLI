/**
 * jdt:// URI 解析器
 *
 * 支持的格式：
 * - `jdt://contents/<container>/<pkg>/<Class>.class?=<hash>`
 *   container 由 JDT 生成，内部可能含 URI 编码字符。
 * - `jdt://jarentry/<jar>!/<pkg>/<Class>.class`（防御性分支，少见）
 *
 * 输入非 jdt:// 或解析失败均返回 null，由调用方降级。
 *
 * 参见：[SP01 子计划 Task 1.3](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import type { ParsedJdtUri } from './types';

const JDT_CONTENTS_PREFIX = 'jdt://contents/';
const JDT_JARENTRY_PREFIX = 'jdt://jarentry/';

/**
 * 解析 jdt:// URI
 *
 * @param uri 待解析 URI
 * @returns 成功返回 { container, fqcn }，否则 null
 */
export function parse(uri: string): ParsedJdtUri | null {
  if (typeof uri !== 'string' || uri.length === 0) {
    return null;
  }

  if (uri.startsWith(JDT_CONTENTS_PREFIX)) {
    return parseContentsUri(uri);
  }

  if (uri.startsWith(JDT_JARENTRY_PREFIX)) {
    return parseJarEntryUri(uri);
  }

  return null;
}

/**
 * 解析 `jdt://contents/<container>/<pkg>/<Class>.class?=...`
 *
 * container 可能含有编码过的斜杠；我们按照"最后一个 `.class` 之前的最后一段路径为 Class 简名"来切分，
 * 其前的所有路径段用 `/` 连接并转换为 `.` 视为包名；再之前的部分整体作为 container。
 */
function parseContentsUri(uri: string): ParsedJdtUri | null {
  // 去掉 query（?=<hash>）
  const qIdx = uri.indexOf('?');
  const bodyWithPrefix = qIdx >= 0 ? uri.slice(0, qIdx) : uri;
  const body = bodyWithPrefix.slice(JDT_CONTENTS_PREFIX.length);

  // 必须以 .class 结尾
  if (!body.endsWith('.class')) {
    return null;
  }

  const withoutExt = body.slice(0, -'.class'.length);
  const segments = withoutExt.split('/').filter(s => s.length > 0);
  if (segments.length < 2) {
    // 至少要有 <container> + <Class>
    return null;
  }

  // 最后一段是 Class 简名
  const simpleName = segments[segments.length - 1];

  // 从右向左找到包路径起点：JDT 的典型结构是
  // container 段数 = 1（例如 "java.base"）时前面为包名；
  // 也可能 container 由多个段拼接。我们采用启发式：
  //   从右往左找到第一个"全小写或含 $"的段作为包名首段，其左侧为 container。
  // 简化起见，仅把 container 视为第一段，其余视为包名。
  // 这符合 JDT LS 对 `jdt://contents/<container>/<fqcn path>.class` 的常见实际布局。
  const container = decodeURIComponentSafe(segments[0]);
  const pkgSegments = segments.slice(1, -1).map(decodeURIComponentSafe);
  const fqcn = pkgSegments.length > 0
    ? `${pkgSegments.join('.')}.${decodeURIComponentSafe(simpleName)}`
    : decodeURIComponentSafe(simpleName);

  if (fqcn.length === 0) {
    return null;
  }

  return { container, fqcn };
}

/**
 * 解析 `jdt://jarentry/<jar>!/<pkg>/<Class>.class`
 */
function parseJarEntryUri(uri: string): ParsedJdtUri | null {
  const body = uri.slice(JDT_JARENTRY_PREFIX.length);
  const bangIdx = body.indexOf('!/');
  if (bangIdx < 0) {
    return null;
  }
  const container = decodeURIComponentSafe(body.slice(0, bangIdx));
  const entryPath = body.slice(bangIdx + 2);
  if (!entryPath.endsWith('.class')) {
    return null;
  }
  const fqcn = entryPath.slice(0, -'.class'.length).split('/').filter(Boolean).map(decodeURIComponentSafe).join('.');
  if (fqcn.length === 0) {
    return null;
  }
  return { container, fqcn };
}

/**
 * 安全的 decodeURIComponent，失败时原样返回
 */
function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
