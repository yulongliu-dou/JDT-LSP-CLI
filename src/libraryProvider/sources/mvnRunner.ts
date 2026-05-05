/**
 * Maven 依赖源码下载器
 *
 * 封装 `mvn dependency:sources` 子进程调用。
 * - Windows 使用 `mvn.cmd`，其它平台 `mvn`
 * - 预检测 mvn 可用性，不可用抛 `MvnNotFoundError`
 * - 30s 超时，超时触发 SIGKILL + Windows taskkill
 *
 * 参见：[SP04 子计划 Task 4.3](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import * as os from 'os';
import * as path from 'path';
import { spawnWithTimeout, SpawnResult } from '../platform/childProcessUtils';
import type { GAV } from '../core/types';

export class MvnNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MvnNotFoundError';
  }
}

export interface MvnDependencySourcesOptions {
  /** 工作区根目录（用于 cwd，可选） */
  workspaceRoot?: string;
  /** 目标 artifact（单 artifact 模式） */
  gavs?: GAV[];
  /** 是否排除传递依赖 */
  excludeTransitive?: boolean;
  /** 超时毫秒，默认 30s */
  timeoutMs?: number;
}

/**
 * 检测 mvn 可执行文件是否存在
 */
export function detectMvn(): string | null {
  const isWindows = os.platform() === 'win32';
  const cmd = isWindows ? 'mvn.cmd' : 'mvn';

  // 使用 where/which 检测
  try {
    const whichCmd = isWindows ? 'where' : 'which';
    const { execSync } = require('child_process');
    const out = execSync(`${whichCmd} ${cmd}`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out && out.includes(cmd)) {
      return path.resolve(out.split(/\r?\n/)[0].trim());
    }
  } catch {
    // ignore
  }

  // 备选：检查 M2_HOME / MAVEN_HOME 环境变量
  const mavenHome = process.env.M2_HOME || process.env.MAVEN_HOME;
  if (mavenHome) {
    const candidate = path.join(mavenHome, 'bin', cmd);
    try {
      const fs = require('fs');
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * 执行 `mvn dependency:sources`
 *
 * @returns 成功返回 { ok: true, stderr: '' }；失败/超时返回 { ok: false, stderr }
 * @throws MvnNotFoundError 当 mvn 不可用
 */
export async function runDependencySources(
  opts: MvnDependencySourcesOptions = {}
): Promise<{ ok: boolean; stderr: string }> {
  const mvnExe = detectMvn();
  if (!mvnExe) {
    throw new MvnNotFoundError(
      'mvn not found in PATH, M2_HOME, or MAVEN_HOME. '
      + 'Install Maven or set --source-download-mode=none to skip sources download.'
    );
  }

  const isWindows = os.platform() === 'win32';
  // Windows 下 mvn.cmd 需要 shell 模式
  const cmd = isWindows ? mvnExe : mvnExe;

  const args: string[] = ['dependency:sources'];

  // 单/批量 artifact 模式：groupId 和 artifactId 以逗号合并（Maven 原生支持）
  if (opts.gavs && opts.gavs.length > 0) {
    const groupIds = [...new Set(opts.gavs.map(g => g.groupId))].join(',');
    const artifactIds = [...new Set(opts.gavs.map(g => g.artifactId))].join(',');
    args.push(`-DincludeGroupIds=${groupIds}`);
    args.push(`-DincludeArtifactIds=${artifactIds}`);
    args.push('-Dclassifier=sources');
  }

  if (opts.excludeTransitive) {
    args.push('-DexcludeTransitive=true');
  }

  // 非交互式，不下载 javadoc
  args.push('-B', '-DdownloadJavadocs=false');

  const timeoutMs = opts.timeoutMs ?? 30_000;

  let result: SpawnResult;
  try {
    result = await spawnWithTimeout(cmd, args, {
      timeoutMs,
      cwd: opts.workspaceRoot,
      maxBufferBytes: 2 * 1024 * 1024, // 2MB
    });
  } catch (err: any) {
    return { ok: false, stderr: `spawn error: ${err?.message || err}` };
  }

  if (result.timedOut) {
    return { ok: false, stderr: `mvn dependency:sources timed out after ${timeoutMs}ms` };
  }

  if (result.code !== 0) {
    return {
      ok: false,
      stderr: result.stderr || `mvn exited with code ${result.code}`,
    };
  }

  return { ok: true, stderr: '' };
}
