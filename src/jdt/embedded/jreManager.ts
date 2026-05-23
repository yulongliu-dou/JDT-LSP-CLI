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
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
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
   * 确保有可用的 JRE（主入口）
   */
  async ensure(): Promise<JreInfo> {
    // 1. 检查本地缓存
    const cachedJres = this.listCachedJres();
    if (cachedJres.length > 0) {
      const jre = cachedJres[0];
      console.log(`✓ 使用内嵌 JRE: ${jre.version} (${jre.path})`);
      return { ...jre, source: 'embedded' };
    }

    // 2. 检测阶段提示
    console.log('🔍 正在检测 Java 运行环境...');
    const platform = getAdoptiumPlatform();
    console.log('   未找到内嵌 JRE，正在下载 Adoptium JRE 21');
    console.log(`   平台: ${platform.os} ${platform.arch}`);

    // 3. 网络探测
    const networkOk = await this.probeNetwork();

    if (!networkOk) {
      console.log('⚠️  无法连接到 Adoptium 下载服务，将尝试使用系统已有 JRE');
      return this.handleFallback(JRE_TARGET_VERSION);
    }

    // 4. 下载
    try {
      console.log('⬇ 正在下载 Adoptium JRE 21...');
      console.log(`   来源: ${ADOPTIUM_API_BASE}`);

      const apiUrl = buildAdoptiumUrl(platform.os, platform.arch);
      const asset = await fetchJreAsset(apiUrl);

      const tmpFile = path.join(
        this.jreStorageDir,
        `jre-${asset.version}.${platform.ext}`
      );
      await downloadFile(asset.downloadUrl, tmpFile);

      console.log('  正在校验 SHA256...');
      const valid = await this.verifyChecksum(tmpFile, asset.checksum);
      if (!valid) {
        throw new Error('SHA256 校验失败：下载文件可能已损坏');
      }
      console.log('✓ SHA256 校验通过');

      const destDir = path.join(this.jreStorageDir, asset.version);
      console.log('  正在解压...');
      await this.extractJre(tmpFile, destDir);

      // 清理临时文件
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      // Unix: 确保 java 可执行
      if (os.platform() !== 'win32') {
        const javaExe = path.join(destDir, 'bin', 'java');
        try { fs.chmodSync(javaExe, 0o755); } catch { /* ignore */ }
      }

      console.log(`✓ 解压完成: ${destDir}`);
      console.log('   JRE 就绪，正在启动 JDT LS...');
      console.log('');

      return {
        version: asset.version,
        path: destDir,
        javaExe: path.join(destDir, 'bin',
          os.platform() === 'win32' ? 'java.exe' : 'java'),
        source: 'embedded',
      };
    } catch (err: any) {
      console.log(`✗ 下载失败: ${err.message}`);
      return this.handleFallback(JRE_TARGET_VERSION);
    }
  }

  /**
   * 获取 JRE 状态
   */
  async getStatus(): Promise<{ source: string; version: string; path: string; size: string; ready: boolean }> {
    const cached = this.listCachedJres();
    if (cached.length > 0) {
      const jre = cached[0];
      let size = '未知';
      try {
        const files = fs.readdirSync(jre.path);
        let totalSize = 0;
        for (const file of files) {
          try {
            const stat = fs.statSync(path.join(jre.path, file));
            totalSize += stat.size;
          } catch { /* skip */ }
        }
        size = `${(totalSize / 1024 / 1024).toFixed(1)} MB`;
      } catch { /* skip */ }
      return {
        source: 'embedded (Adoptium)',
        version: `${jre.version} (LTS)`,
        path: jre.path,
        size,
        ready: true,
      };
    }
    return { source: 'none', version: '-', path: '-', size: '-', ready: false };
  }

  /**
   * 移除内嵌 JRE
   */
  async remove(): Promise<void> {
    const cached = this.listCachedJres();
    for (const jre of cached) {
      try {
        fs.rmSync(jre.path, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  // ========== 内部方法 ==========

  private async getCachedJre(version: string): Promise<JreInfo | null> {
    const jrePath = path.join(this.jreStorageDir, version);
    if (!fs.existsSync(jrePath)) return null;

    const javaExe = path.join(
      jrePath, 'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    );
    if (!fs.existsSync(javaExe)) return null;

    return { version, path: jrePath, javaExe, source: 'embedded' };
  }

  private probeNetwork(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = https.request(
        `${ADOPTIUM_API_BASE}/v3/assets/latest/${JRE_TARGET_VERSION}/hotspot?image_type=jre&project=jdk&vendor=eclipse&os=linux&arch=x64`,
        { method: 'HEAD', timeout: NETWORK_PROBE_TIMEOUT_MS },
        (res) => resolve(res.statusCode !== undefined && res.statusCode < 500)
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  listCachedJres(): JreInfo[] {
    const jres: JreInfo[] = [];
    if (!fs.existsSync(this.jreStorageDir)) return jres;

    const versions = fs.readdirSync(this.jreStorageDir);
    for (const version of versions) {
      const jreInfo = this.getCachedJreSync(version);
      if (jreInfo) jres.push(jreInfo);
    }
    return jres;
  }

  private getCachedJreSync(version: string): JreInfo | null {
    const jrePath = path.join(this.jreStorageDir, version);
    if (!fs.existsSync(jrePath)) return null;

    const javaExe = path.join(
      jrePath, 'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    );
    if (!fs.existsSync(javaExe)) return null;

    return { version, path: jrePath, javaExe, source: 'embedded' };
  }

  private async verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    if (!expectedChecksum) {
      console.warn('⚠️  未获取到 SHA256 校验值，跳过完整性检查');
      return true;
    }

    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex') === expectedChecksum));
      stream.on('error', () => resolve(false));
    });
  }

  private async extractJre(archivePath: string, destDir: string): Promise<void> {
    ensureDir(destDir);

    const platform = os.platform();
    const isZip = archivePath.endsWith('.zip');

    if (platform === 'win32' && isZip) {
      const cmd = `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`;
      execSync(cmd, { stdio: 'pipe', timeout: 120000 });
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, {
        stdio: 'pipe', timeout: 120000,
      });
      // 如果解压后有一个中间目录，将其内容上移一层
      const entries = fs.readdirSync(destDir);
      if (entries.length === 1) {
        const innerDir = path.join(destDir, entries[0]);
        if (fs.statSync(innerDir).isDirectory()) {
          const tmpDir = destDir + '_tmp';
          fs.renameSync(innerDir, tmpDir);
          const files = fs.readdirSync(tmpDir);
          for (const file of files) {
            fs.renameSync(path.join(tmpDir, file), path.join(destDir, file));
          }
          fs.rmdirSync(tmpDir);
        }
      }
    }
  }

  private async fallbackToExistingJre(minVersion: number): Promise<JreInfo | null> {
    const candidates: { exe: string; source: 'redhat' | 'system' }[] = [];

    // 1. Red Hat 扩展 JRE
    const extPaths = [
      path.join(os.homedir(), '.vscode', 'extensions'),
      path.join(os.homedir(), '.vscode-server', 'extensions'),
      path.join(os.homedir(), '.qoder', 'extensions'),
    ];
    for (const extBase of extPaths) {
      try {
        if (!fs.existsSync(extBase)) continue;
        const dirs = fs.readdirSync(extBase);
        const javaExt = dirs.find(d => d.startsWith('redhat.java-'));
        if (!javaExt) continue;
        const extPath = path.join(extBase, javaExt);
        const jrePath = path.join(extPath, 'jre');
        if (!fs.existsSync(jrePath)) continue;
        const jreDirs = fs.readdirSync(jrePath);
        for (const jreDir of jreDirs) {
          const javaExe = path.join(jrePath, jreDir, 'bin',
            os.platform() === 'win32' ? 'java.exe' : 'java');
          if (fs.existsSync(javaExe)) {
            candidates.push({ exe: javaExe, source: 'redhat' });
          }
        }
      } catch { /* skip */ }
    }

    // 2. JAVA_HOME
    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
      const javaExe = path.join(javaHome, 'bin',
        os.platform() === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(javaExe)) {
        candidates.push({ exe: javaExe, source: 'system' });
      }
    }

    // 3. PATH 上的 java
    candidates.push({
      exe: os.platform() === 'win32' ? 'java.exe' : 'java',
      source: 'system',
    });

    for (const { exe, source } of candidates) {
      const version = detectJavaVersion(exe);
      if (version !== null && version >= minVersion) {
        const jrePath = path.dirname(path.dirname(exe));
        return { version: String(version), path: jrePath, javaExe: exe, source };
      }
    }

    return null;
  }

  private async handleFallback(minVersion: number): Promise<JreInfo> {
    const jre = await this.fallbackToExistingJre(minVersion);

    if (jre) {
      console.log(`   将使用非优化版系统 JRE ${jre.version}`);
      console.log('   Adoptium 内嵌 JRE 经过特殊优化：精简体积、更低内存占用');
      console.log('   网络恢复后运行 `jls jre download` 可获取优化版 JRE');
      console.log('');
      return jre;
    }

    const platform = getAdoptiumPlatform();
    console.error('');
    console.error('✗ 未找到兼容 JRE (需要 >= 21)');
    console.error('   Java 21 提供虚拟线程、分代 ZGC 等特性，性能更佳、内存占用更低');
    console.error('');
    console.error('   请手动下载 JRE 并放置到以下目录:');
    console.error('');
    console.error(`   下载地址: ${ADOPTIUM_API_BASE}/v3/assets/latest/${JRE_TARGET_VERSION}/hotspot?image_type=jre&project=jdk&vendor=eclipse&os=${platform.os}&arch=${platform.arch}`);
    console.error('');
    console.error(`   放置目录: ${this.jreStorageDir}/<version>/`);
    console.error('   (需包含 bin/java 或 bin/java.exe)');
    console.error('');
    process.exit(1);
  }
}

/**
 * 从 java -version 输出中提取主版本号
 */
export function parseJavaVersion(output: string): number | null {
  const match = output.match(/version\s+"([^"]+)"/);
  if (!match) return null;

  const version = match[1];
  if (version.startsWith('1.')) {
    const parts = version.split('.');
    if (parts.length >= 2) return parseInt(parts[1], 10) || null;
  }

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
    const stderr = err.stderr || err.stdout || '';
    if (stderr) return parseJavaVersion(stderr);
    return null;
  }
}

interface JreAsset {
  downloadUrl: string;
  checksum: string;
  size: number;
  version: string;
}

export function buildAdoptiumUrl(osName: string, archName: string): string {
  const params = new URLSearchParams({
    image_type: 'jre',
    project: 'jdk',
    vendor: 'eclipse',
    os: osName,
    arch: archName,
  });
  return `${ADOPTIUM_API_BASE}/v3/assets/latest/${JRE_TARGET_VERSION}/hotspot?${params}`;
}

export function fetchJreAsset(apiUrl: string): Promise<JreAsset> {
  return new Promise((resolve, reject) => {
    const { protocol } = new URL(apiUrl);
    const client = protocol === 'https:' ? https : http;

    client.get(apiUrl, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try {
          const assets = JSON.parse(body);
          if (!Array.isArray(assets) || assets.length === 0) {
            reject(new Error('No JRE asset found in API response'));
            return;
          }
          const binary = assets[0]?.binary;
          if (!binary?.package?.link) {
            reject(new Error('Invalid API response: missing download link'));
            return;
          }
          resolve({
            downloadUrl: binary.package.link,
            checksum: binary.package.checksum || '',
            size: binary.package.size || 0,
            version: assets[0].version?.semver || '21.0.0',
          });
        } catch (e: any) {
          reject(new Error(`Failed to parse Adoptium API response: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

interface DownloadState {
  downloaded: number;
  total: number;
  startTime: number;
  lastUpdateTime: number;
  lastDownloaded: number;
}

function renderProgress(state: DownloadState): string {
  const { downloaded, total } = state;

  if (total === 0) {
    return `\r  下载中... ${(downloaded / 1024 / 1024).toFixed(1)} MB`;
  }

  const pct = Math.min(100, Math.round((downloaded / total) * 100));
  const barWidth = 30;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

  const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
  const totalMB = (total / 1024 / 1024).toFixed(1);

  const now = Date.now();
  const timeDiff = (now - state.lastUpdateTime) / 1000;
  const byteDiff = downloaded - state.lastDownloaded;
  const speed = timeDiff > 0 ? (byteDiff / timeDiff) : 0;
  const speedStr = speed > 1024 * 1024
    ? `${(speed / 1024 / 1024).toFixed(1)} MB/s`
    : `${(speed / 1024).toFixed(0)} KB/s`;

  const remaining = speed > 0 ? ((total - downloaded) / speed) : 0;
  const remainingStr = remaining > 60
    ? `${Math.ceil(remaining / 60)}m`
    : `${Math.ceil(remaining)}s`;

  return `\r  ${bar} ${pct}%  ${downloadedMB} MB / ${totalMB} MB · ${speedStr} · 剩余 ${remainingStr}`;
}

function downloadFile(url: string, dest: string, onProgress?: (state: DownloadState) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const { protocol } = new URL(url);
    const client = protocol === 'https:' ? https : http;

    client.get(url, { timeout: 300000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          return downloadFile(redirectUrl, dest, onProgress).then(resolve).catch(reject);
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      const state: DownloadState = {
        downloaded: 0, total, startTime: Date.now(),
        lastUpdateTime: Date.now(), lastDownloaded: 0,
      };

      const fileStream = fs.createWriteStream(dest);

      res.on('data', (chunk: Buffer) => {
        state.downloaded += chunk.length;
        const now = Date.now();
        if (now - state.lastUpdateTime >= 200) {
          if (onProgress) onProgress(state);
          else process.stdout.write(renderProgress(state));
          state.lastUpdateTime = now;
          state.lastDownloaded = state.downloaded;
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        if (onProgress) onProgress({ ...state, downloaded: total || state.downloaded });
        else {
          process.stdout.write(renderProgress({ ...state, downloaded: total || state.downloaded }));
          process.stdout.write('\n');
        }
        resolve();
      });

      fileStream.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      res.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// 单例实例
let instance: EmbeddedJreManager | null = null;

export function getJreManager(): EmbeddedJreManager {
  if (!instance) instance = new EmbeddedJreManager();
  return instance;
}
