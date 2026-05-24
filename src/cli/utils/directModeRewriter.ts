/**
 * CLI 直接模式下的 URI 重写工具
 *
 * 直接模式（--no-daemon / daemon 不可用时的 fallback）绕过守护进程，
 * 无法使用 daemon 端的 rewriteLocation/rewriteLocations。
 * 本模块为 CLI 直接路径提供等效的 URI 重写能力。
 *
 * 已有 positionResolver.ts 中 resolvePosition 的直接模式 fallback，
 * 这里抽取为可被各命令 direct handler 复用的工具函数。
 */

import { setLibraryLocator, rewriteLocation, rewriteLocations } from '../../libraryProvider/uriRewriter';
import { LibraryClassLocator } from '../../libraryProvider/core/libraryClassLocator';
import { load as loadDaemonConfig } from '../../libraryProvider/daemonConfigStore';

/**
 * 初始化 CLI 直接模式的 library locator（用于 jdt:// URI 重写）
 * 调用方应在创建 JdtLsClient 并 start() 后立即调用
 */
export async function initDirectModeRewriter(client: any, projectPath: string): Promise<void> {
  const config = loadDaemonConfig();
  const locator = new LibraryClassLocator({
    fetcher: {
      getClassFileContents: (jdtUri: string) => client.getClassFileContents(jdtUri),
    },
    workspaceRoot: projectPath,
    javaHome: process.env.JAVA_HOME,
    config,
  });
  setLibraryLocator(locator);
}

/**
 * 对 Location 数组执行 URI 重写（直接模式）
 * rewriteLocations 内部已处理: 空数组透传、非 jdt:// URI 透传、resolve 禁用透传
 */
export async function rewriteDirectLocations(
  locations: any[] | null | undefined
): Promise<any[]> {
  if (!locations || locations.length === 0) return locations || [];
  return rewriteLocations(locations);
}

/**
 * 对 workspace/symbol 返回的 SymbolInformation[] 执行 URI 重写
 * SymbolInformation 结构: { name, kind, location: { uri, range }, containerName? }
 */
export async function rewriteDirectSymbols(
  symbols: any[] | null | undefined
): Promise<any[]> {
  if (!symbols || symbols.length === 0) return symbols || [];

  const rewritten = await Promise.all(
    symbols.map(async (s: any) => {
      if (s.location) {
        const rewrittenLoc = await rewriteLocation(s.location);
        return { ...s, location: rewrittenLoc };
      }
      return s;
    })
  );
  return rewritten;
}
