/**
 * 子进程封装（跨平台）
 *
 * 提供带超时的 spawn 封装。Windows 下：
 * - 命令以 `.cmd` / `.bat` 结尾自动加 `shell: true`，避免 ENOENT
 * - 用 `windowsHide: true` 隐藏控制台窗口
 *
 * 参见：[SP01 子计划 Task 1.10](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import { spawn, SpawnOptions } from 'child_process';
import * as os from 'os';

export interface SpawnResult {
  /** 退出码；null 表示被信号终止或超时 kill */
  code: number | null;
  stdout: string;
  stderr: string;
  /** 是否因超时被 kill */
  timedOut: boolean;
}

export interface SpawnOptionsExt {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** 最大输出缓冲（防止无限增长）。默认 10MB */
  maxBufferBytes?: number;
}

/**
 * 带超时的 spawn
 *
 * @param cmd 命令（绝对或可执行名）
 * @param args 参数
 * @param options 选项
 */
export async function spawnWithTimeout(
  cmd: string,
  args: string[],
  options: SpawnOptionsExt = {}
): Promise<SpawnResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxBuffer = options.maxBufferBytes ?? 10 * 1024 * 1024;

  const isWindows = os.platform() === 'win32';
  const lower = cmd.toLowerCase();
  const needsShell = isWindows && (lower.endsWith('.cmd') || lower.endsWith('.bat'));

  const spawnOpts: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    shell: needsShell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(cmd, args, spawnOpts);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString('utf8');
      }
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      finish(null);
    });
    child.on('close', (code) => {
      finish(code);
    });
  });
}
