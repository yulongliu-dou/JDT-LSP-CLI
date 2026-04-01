/**
 * 进程工具函数
 */

import { spawn, SpawnOptions } from 'child_process';

/**
 * 生成跨平台的 spawn 选项（隐藏 Windows 窗口）
 */
export function createSpawnOptions(options: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    ...options,
    windowsHide: true, // Windows: 隐藏控制台窗口
  };
}

/**
 * 等待进程退出
 */
export function waitForProcessExit(childProcess: any): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    childProcess.on('exit', (code: number | null, signal: string | null) => {
      resolve({ code, signal });
    });
    
    childProcess.on('error', () => {
      resolve({ code: null, signal: 'ERROR' });
    });
  });
}

/**
 * 安全终止进程
 */
export function killProcess(childProcess: any, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  try {
    if (childProcess && !childProcess.killed) {
      childProcess.kill(signal);
    }
  } catch (error) {
    // 忽略终止错误
  }
}
