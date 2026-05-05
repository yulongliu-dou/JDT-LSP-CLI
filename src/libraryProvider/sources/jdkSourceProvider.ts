/**
 * JDK 源码提供器
 *
 * 从 `$JAVA_HOME/lib/src.zip` 抽取 JDK 类源码，写入全局缓存：
 *   `~/.lsp-cache/global/jdk/<javaMajor>/<module>/<fqcn-path>.java`
 *
 * 支持两种布局：
 * - JDK 8 平铺：src.zip 顶层为包（java/util/List.java）
 * - JDK 9+ 模块化：src.zip 顶层为模块（java.base/java/util/List.java）
 *
 * JAVA_HOME 探测顺序：
 *   1) 环境变量 `JAVA_HOME`
 *   2) CLI 可调用时复用 launcher.javaExecutable（运行时由调用方注入）
 *   3) macOS 常见路径
 *
 * 参见：[SP01 子计划 Task 1.5](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ZipReader } from '../platform/zipReader';
import { getLspCacheRoot } from '../platform/pathUtils';

export interface JdkSourceFetchCtx {
  /** 全限定类名，例如 java.util.List */
  fqcn: string;
  /** 可选：外部注入的 JAVA_HOME，优先级最高 */
  javaHome?: string;
  /** 可选：外部注入的 Java 主版本号，避免重复探测 */
  javaMajor?: number;
}

export interface JdkSourceFetchResult {
  /** 生成的缓存文件绝对路径 */
  cachePath: string;
  /** 识别出的模块名（JDK 8 平铺时为 'default'） */
  module: string;
  /** Java 主版本号 */
  javaMajor: number;
}

/**
 * 解析 fqcn 为 ZIP entry 相对路径（不含模块前缀）。例如：
 *   java.util.List → java/util/List.java
 */
function fqcnToEntryPath(fqcn: string): string {
  return fqcn.replace(/\./g, '/') + '.java';
}

/**
 * 探测候选 src.zip 路径（按优先级）
 */
function findSrcZip(javaHome: string | undefined): string | null {
  const candidates: string[] = [];
  if (javaHome) {
    candidates.push(path.join(javaHome, 'lib', 'src.zip'));
    candidates.push(path.join(javaHome, 'src.zip'));
  }
  if (os.platform() === 'darwin') {
    // macOS 常见布局
    const base = '/Library/Java/JavaVirtualMachines';
    if (fs.existsSync(base)) {
      try {
        for (const dir of fs.readdirSync(base)) {
          candidates.push(path.join(base, dir, 'Contents', 'Home', 'lib', 'src.zip'));
        }
      } catch {
        // ignore
      }
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 尝试读取 release 文件以识别 Java 主版本
 */
function detectJavaMajor(javaHome: string | undefined): number {
  if (!javaHome) return 0;
  try {
    const releaseFile = path.join(javaHome, 'release');
    if (!fs.existsSync(releaseFile)) return 0;
    const text = fs.readFileSync(releaseFile, 'utf-8');
    const m = text.match(/JAVA_VERSION="(\d+)(?:\.(\d+))?/);
    if (!m) return 0;
    const first = parseInt(m[1], 10);
    // Java 1.8 → major 8；Java 11 → major 11
    if (first === 1 && m[2]) return parseInt(m[2], 10);
    return first;
  } catch {
    return 0;
  }
}

/**
 * 解析 JAVA_HOME
 */
function resolveJavaHome(explicit?: string): string | undefined {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const env = process.env.JAVA_HOME;
  if (env && fs.existsSync(env)) return env;
  return undefined;
}

/**
 * 在 ZIP 中定位类源码，返回 { entryName, module } 或 null
 */
export function locateClassInSrcZip(
  zip: ZipReader,
  fqcn: string
): { entryName: string; module: string } | null {
  const relPath = fqcnToEntryPath(fqcn);

  // 先直接查 JDK 8 平铺（java/util/List.java）
  if (zip.has(relPath)) {
    return { entryName: relPath, module: 'default' };
  }

  // 再尝试 JDK 9+ 模块化：遍历顶层目录
  const tops = zip.listTopLevelDirs();
  // 先按常见模块名优先检查
  const priority = ['java.base', 'java.desktop', 'java.sql', 'java.logging', 'java.xml'];
  const ordered = [
    ...priority.filter(m => tops.includes(m)),
    ...tops.filter(m => !priority.includes(m)),
  ];
  for (const mod of ordered) {
    // 只有模块名形如 `java.*` / `jdk.*` / `javafx.*` 才当模块处理
    if (!/^(java|jdk|javafx|javax)\./.test(mod) && mod !== 'java.base') {
      continue;
    }
    const candidate = `${mod}/${relPath}`;
    if (zip.has(candidate)) {
      return { entryName: candidate, module: mod };
    }
  }
  return null;
}

/**
 * 提取 JDK 类源码到缓存
 *
 * @returns 成功返回结果，失败返回 null（JAVA_HOME / src.zip / 类均不存在等）
 */
export async function fetch(ctx: JdkSourceFetchCtx): Promise<JdkSourceFetchResult | null> {
  if (!ctx?.fqcn) return null;

  const javaHome = resolveJavaHome(ctx.javaHome);
  const srcZipPath = findSrcZip(javaHome);
  if (!srcZipPath) {
    return null;
  }

  const javaMajor = ctx.javaMajor && ctx.javaMajor > 0 ? ctx.javaMajor : detectJavaMajor(javaHome) || 0;

  let zip: ZipReader;
  try {
    zip = ZipReader.fromFile(srcZipPath);
  } catch {
    return null;
  }

  const located = locateClassInSrcZip(zip, ctx.fqcn);
  if (!located) return null;

  const content = zip.readText(located.entryName);
  if (content === null) return null;

  // 写入缓存：~/.lsp-cache/global/jdk/<javaMajor>/<module>/<pkg>/<Class>.java
  const majorLabel = javaMajor > 0 ? String(javaMajor) : 'unknown';
  const cacheDir = path.join(
    getLspCacheRoot(),
    'global',
    'jdk',
    majorLabel,
    located.module
  );
  const cachePath = path.join(cacheDir, fqcnToEntryPath(ctx.fqcn));

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    // 已存在同样内容则跳过
    if (!fs.existsSync(cachePath)) {
      const tmp = cachePath + '.tmp';
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, cachePath);
    }
  } catch {
    return null;
  }

  return {
    cachePath,
    module: located.module,
    javaMajor: javaMajor || 0,
  };
}
