/**
 * 内嵌 JRE 管理器
 *
 * 负责:
 * - 自动下载 Adoptium JRE 21
 * - 管理本地 JRE 缓存
 * - 降级到系统已有 JRE
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { ensureDir } from '../../core/utils/fileUtils';
import { log } from '../../core/logger';
import { JRE_STORAGE_DIR, ADOPTIUM_API_BASE, JRE_TARGET_VERSION, NETWORK_PROBE_TIMEOUT_MS, MIN_DISK_SPACE_MB, getAdoptiumPlatform } from './jreConstants';

export interface JreInfo {
  version: string;
  path: string;
  javaExe: string;
  source: 'embedded' | 'redhat' | 'system';
}

export class EmbeddedJreManager {
  private readonly jreStorageDir: string;

  constructor() {
    this.jreStorageDir = JRE_STORAGE_DIR;
    ensureDir(this.jreStorageDir);
  }

  /**
   * 获取或下载指定版本的 JRE
   */
  async getJre(version: string): Promise<JreInfo | null> {
    // TODO: 实现 JRE 下载逻辑
    // 1. 检查本地是否有缓存
    const cached = await this.getCachedJre(version);
    if (cached) {
      return cached;
    }

    // 2. 下载 JRE（未来实现）
    // await this.downloadJre(version);

    log('JRE download not implemented yet, using system Java');
    return null;
  }

  /**
   * 从缓存获取 JRE
   */
  private async getCachedJre(version: string): Promise<JreInfo | null> {
    const jrePath = path.join(this.jreStorageDir, version);
    
    if (!fs.existsSync(jrePath)) {
      return null;
    }

    const javaExe = path.join(
      jrePath,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    );

    if (!fs.existsSync(javaExe)) {
      return null;
    }

    return {
      version,
      path: jrePath,
      javaExe,
      source: 'embedded' as const,
    };
  }

  /**
   * 下载 JRE（占位符）
   */
  private async downloadJre(version: string): Promise<void> {
    // TODO: 实现下载逻辑
    // - 从 Adoptium API 或其他源下载
    // - 支持 Windows/macOS/Linux
    // - 解压到存储目录
    throw new Error('Not implemented');
  }

  /**
   * 列出所有已下载的 JRE
   */
  listCachedJres(): JreInfo[] {
    const jres: JreInfo[] = [];
    
    if (!fs.existsSync(this.jreStorageDir)) {
      return jres;
    }

    const versions = fs.readdirSync(this.jreStorageDir);
    
    for (const version of versions) {
      const jreInfo = this.getCachedJreSync(version);
      if (jreInfo) {
        jres.push(jreInfo);
      }
    }

    return jres;
  }

  private getCachedJreSync(version: string): JreInfo | null {
    const jrePath = path.join(this.jreStorageDir, version);
    
    if (!fs.existsSync(jrePath)) {
      return null;
    }

    const javaExe = path.join(
      jrePath,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    );

    if (!fs.existsSync(javaExe)) {
      return null;
    }

    return {
      version,
      path: jrePath,
      javaExe,
      source: 'embedded' as const,
    };
  }

  /**
   * 清理旧版本 JRE
   */
  async cleanup(keepVersions: string[]): Promise<void> {
    // TODO: 实现清理逻辑
    log('JRE cleanup not implemented yet');
  }
}

/**
 * 从 java -version 输出中提取主版本号
 */
export function parseJavaVersion(output: string): number | null {
  const match = output.match(/version\s+"([^"]+)"/);
  if (!match) return null;

  const version = match[1];
  // 处理 "1.8.0_392" 格式 → 8
  if (version.startsWith('1.')) {
    const parts = version.split('.');
    if (parts.length >= 2) {
      return parseInt(parts[1], 10) || null;
    }
  }

  // 处理 "21.0.5" 格式 → 21
  const parts = version.split('.');
  return parseInt(parts[0], 10) || null;
}

/**
 * 通过执行 java -version 获取版本号
 */
export function detectJavaVersion(javaExe: string): number | null {
  try {
    const output = execSync(`"${javaExe}" -version`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return parseJavaVersion(output);
  } catch (err: any) {
    // java -version 输出到 stderr, execSync 会抛异常但 stderr 中有内容
    const stderr = err.stderr || err.stdout || '';
    if (stderr) {
      return parseJavaVersion(stderr);
    }
    return null;
  }
}

// 单例实例
let instance: EmbeddedJreManager | null = null;

/**
 * 获取 JRE 管理器单例
 */
export function getJreManager(): EmbeddedJreManager {
  if (!instance) {
    instance = new EmbeddedJreManager();
  }
  return instance;
}
