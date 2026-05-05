/**
 * Vineflower 反编译器调用入口
 *
 * 职责：
 * - 定位内嵌的 vineflower jar
 * - 调用 `java -jar vineflower.jar <jarPath> <outDir>` 执行全 jar 反编译
 * - 超时控制（60s）、错误处理、日志落盘
 *
 * 参见：[SP03 子计划 Task 3.2](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnWithTimeout, SpawnResult } from '../platform/childProcessUtils';
import { getLspCacheRoot } from '../platform/pathUtils';

/** 内嵌反编译器 jar 文件名（集中管理版本号） */
export const VINEFLOWER_JAR_NAME = 'vineflower-1.11.2.jar';

export interface VineflowerOptions {
  /** 超时毫秒，默认 60s */
  timeoutMs?: number;
  /** 额外的 java 参数 */
  extraArgs?: string[];
}

/**
 * Vineflower 执行错误
 */
export class VineflowerError extends Error {
  constructor(
    message: string,
    public readonly spawnResult?: SpawnResult
  ) {
    super(message);
    this.name = 'VineflowerError';
  }
}

/**
 * 定位 Vineflower jar 文件
 *
 * 查找顺序：
 * 1. 环境变量 `VINEFLOWER_JAR`（显式指定）
 * 2. 开发态：`<__dirname>/../../../vendor/<jar>`
 * 3. npm 发布态：由调用方注入路径（运行时探测失败时抛错）
 */
function findVineflowerJar(): string {
  const env = process.env.VINEFLOWER_JAR;
  if (env && fs.existsSync(env)) {
    return env;
  }

  // __dirname 推导：当前文件在 `<dist>/libraryProvider/decompile/` 或 `<src>/libraryProvider/decompile/`
  // vendor 在项目根目录
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'vendor', VINEFLOWER_JAR_NAME),
    path.resolve(__dirname, '..', '..', 'vendor', VINEFLOWER_JAR_NAME),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  throw new VineflowerError(
    `Vineflower jar not found: ${VINEFLOWER_JAR_NAME}. ` +
    `Place it in vendor/ or set VINEFLOWER_JAR env.`
  );
}

/**
 * 查找 Java 可执行文件
 *
 * 探测顺序：
 * 1. JAVA_HOME/bin/java
 * 2. 通过 launcher 已有探测（调用方注入）
 * 3. PATH 上的 `java`
 */
export function detectJavaExecutable(launcherJava?: string): string {
  if (launcherJava && fs.existsSync(launcherJava)) {
    return launcherJava;
  }

  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const javaExe = path.join(
      javaHome,
      'bin',
      os.platform() === 'win32' ? 'java.exe' : 'java'
    );
    if (fs.existsSync(javaExe)) {
      return javaExe;
    }
  }

  // 回退到 PATH 上的 java
  return os.platform() === 'win32' ? 'java.exe' : 'java';
}

/**
 * 写入反编译器执行日志（stdout/stderr 尾部 4KB）
 */
function writeVineflowerLog(scope: string, result: SpawnResult): void {
  try {
    const logDir = path.join(getLspCacheRoot(), 'global', 'decompiled', scope);
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, '.vineflower.log');
    const stamp = new Date().toISOString();
    const tail = (s: string) => {
      if (s.length <= 4096) return s;
      return '...(truncated)\n' + s.slice(s.length - 4096);
    };
    const buf =
      `# ${stamp}  exit=${result.code}  timedOut=${result.timedOut}\n` +
      `## STDOUT\n${tail(result.stdout)}\n` +
      `## STDERR\n${tail(result.stderr)}\n`;
    fs.writeFileSync(logPath, buf, 'utf-8');
  } catch {
    // 日志写失败不影响主流程
  }
}

/**
 * 执行 Vineflower 反编译
 *
 * 对单个 jar 执行全量反编译，产出到 `outDir`。
 *
 * @param jarPath  待反编译的 jar 绝对路径
 * @param outDir   输出目录（会自动创建）
 * @param javaExe  Java 可执行文件路径（可通过 detectJavaExecutable 获取）
 * @param opts     可选配置
 * @throws VineflowerError 超时 / 非零退出 / 进程启动失败
 */
export async function runVineflower(
  jarPath: string,
  outDir: string,
  javaExe: string,
  /** 日志 scope（用于 `.vineflower.log` 落盘定位） */
  logScope: string,
  opts?: VineflowerOptions
): Promise<void> {
  const vineflowerJar = findVineflowerJar();
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  fs.mkdirSync(outDir, { recursive: true });

  const args = ['-jar', vineflowerJar, '--silent=1'];
  if (opts?.extraArgs) {
    args.push(...opts.extraArgs);
  }
  args.push(jarPath, outDir);

  let result: SpawnResult;
  try {
    result = await spawnWithTimeout(javaExe, args, {
      timeoutMs,
      maxBufferBytes: 4 * 1024 * 1024, // 4MB 日志上限
    });
  } catch (err: any) {
    throw new VineflowerError(
      `Vineflower spawn failed: ${err?.message || err}`,
      undefined
    );
  }

  // 无论成功与否，写入日志
  writeVineflowerLog(logScope, result);

  if (result.timedOut) {
    throw new VineflowerError(
      `Vineflower timed out after ${timeoutMs}ms for ${path.basename(jarPath)}`,
      result
    );
  }

  if (result.code !== 0) {
    throw new VineflowerError(
      `Vineflower exited with code ${result.code} for ${path.basename(jarPath)}`,
      result
    );
  }
}
