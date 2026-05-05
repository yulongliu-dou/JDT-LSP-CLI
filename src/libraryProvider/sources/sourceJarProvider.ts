/**
 * Sources jar 获取器
 *
 * 流程：
 * 1. 检查 ~/.m2/repository 中是否存在对应 sources jar
 * 2. 否则按 downloadMode 调用 mvnRunner 或 httpDownloader 下载
 * 3. extractFqcn 从 sources jar 中解出指定类的源码
 *
 * 参见：[SP04 子计划 Task 4.2](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import { ZipReader } from '../platform/zipReader';
import { resolveLocalRepo, gavToJarRelativePath } from '../resolvers/mavenDependencyResolver';
import type { GAV } from '../core/types';
import type { SourceDownloadMode } from '../config';
import { runDependencySources, MvnNotFoundError } from './mvnRunner';
import { downloadSourcesJar, NotImplementedError } from './httpDownloader';

export interface FetchSourceJarOptions {
  downloadMode?: SourceDownloadMode;
  /** 工作区根目录（用于 mvn cwd） */
  workspaceRoot?: string;
  /** 超时毫秒 */
  timeoutMs?: number;
}

/**
 * 查找本地 sources jar
 */
function findLocalSourceJar(gav: GAV): string | null {
  const repo = resolveLocalRepo();
  // 构造 sources jar 路径：<gav-path>-sources.jar
  const relative = gavToJarRelativePath(gav);
  const stem = relative.slice(0, -'.jar'.length);
  const sourcesPath = path.join(repo, `${stem}-sources.jar`);
  if (fs.existsSync(sourcesPath)) return sourcesPath;

  // 非 classifier 版本：sources jar 不含 classifier
  if (!gav.classifier) {
    // 直接替换 .jar → -sources.jar
    const altPath = path.join(
      path.dirname(path.join(repo, relative)),
      `${gav.artifactId}-${gav.version}-sources.jar`
    );
    if (fs.existsSync(altPath)) return altPath;
  }

  return null;
}

/**
 * 获取 sources jar 本地路径
 *
 * @param gav Maven 坐标
 * @param opts 下载模式等配置
 * @returns sources jar 绝对路径，或 null
 */
export async function fetchSourceJar(
  gav: GAV,
  opts: FetchSourceJarOptions = {}
): Promise<string | null> {
  // 1. 本地命中
  const local = findLocalSourceJar(gav);
  if (local) return local;

  const mode = opts.downloadMode ?? 'mvn';

  // 2. downloadMode=off → 不下载
  if (mode === 'none') return null;

  // 3. downloadMode=mvn → 通过 mvn 下载
  if (mode === 'mvn') {
    try {
      const result = await runDependencySources({
        gavs: [gav],
        workspaceRoot: opts.workspaceRoot,
        timeoutMs: opts.timeoutMs,
      });
      if (result.ok) {
        // 重新检查本地
        const afterDownload = findLocalSourceJar(gav);
        return afterDownload;
      }
      // 下载失败，记录日志但不抛异常
      return null;
    } catch (err) {
      if (err instanceof MvnNotFoundError) {
        // mvn 不可用 → 静默降级
        return null;
      }
      return null;
    }
  }

  // 4. downloadMode=http → 调用 httpDownloader（本期抛 NotImplementedError）
  if (mode === 'http') {
    try {
      return await downloadSourcesJar(gav);
    } catch {
      // NotImplementedError → 静默降级
      return null;
    }
  }

  return null;
}

/**
 * 从 sources jar 中提取指定 fqcn 的源码到 outDir
 *
 * @param sourceJarPath sources jar 绝对路径
 * @param fqcn 全限定类名
 * @param outDir 输出目录
 * @returns 提取后的 .java 文件绝对路径，未命中返回 null
 */
export async function extractFqcn(
  sourceJarPath: string,
  fqcn: string,
  outDir: string
): Promise<string | null> {
  let zip: ZipReader;
  try {
    zip = ZipReader.fromFile(sourceJarPath);
  } catch {
    return null;
  }

  // fqcn → entry 路径：com.google.common.collect.Lists → com/google/common/collect/Lists.java
  const entryName = fqcn.replace(/\./g, '/') + '.java';

  const content = zip.readText(entryName);
  if (content === null) return null;

  const outPath = path.join(outDir, entryName);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (!fs.existsSync(outPath)) {
      const tmp = outPath + '.tmp';
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, outPath);
    }
  } catch {
    return null;
  }

  return outPath;
}
