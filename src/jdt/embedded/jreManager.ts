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
import { JRE_STORAGE_DIR, ADOPTIUM_API_ASSETS_URL, GITHUB_API_RELEASES_URL, USTC_MIRROR_BASE, TUNA_MIRROR_BASE, JRE_TARGET_VERSION, PROBE_TIMEOUT_MS, ADOPTIUM_PROBE_TIMEOUT_MS, DOWNLOAD_RETRY_MAX, DOWNLOAD_RETRY_BASE_MS, getAdoptiumPlatform } from './jreConstants';

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
  async ensure(interactive: boolean = false): Promise<JreInfo> {
    // 1. 检查本地缓存
    const cachedJres = this.listCachedJres();
    if (cachedJres.length > 0) {
      const jre = cachedJres[0];
      console.log(`✓ 使用内嵌 JRE: ${jre.version} (${jre.path})`);
      return { ...jre, source: 'embedded' };
    }

    // 2. 检测阶段提示
    const platform = getAdoptiumPlatform();
    console.log('🔍 正在检测 Java 运行环境...');
    console.log(`   未找到内嵌 JRE，正在并发探测可用下载源`);
    console.log(`   平台: ${platform.os} ${platform.arch}`);
    console.log('');

    // 3. 并发探测所有源
    const results = await probeAllSources(platform.os, platform.arch);

    // 4. 展示探测结果
    for (const r of results) {
      if (r.asset) {
        console.log(`   ✅ ${r.source.label.padEnd(18)} · ${r.asset.version.padEnd(14)} · ${r.latency}ms`);
      } else {
        console.log(`   ❌ ${r.source.label.padEnd(18)} · ${r.error || '不可达'}`);
      }
    }
    console.log('');

    // 5. 过滤可达源
    const reachable = results.filter(r => r.asset !== null);

    if (reachable.length > 0) {
      if (interactive) {
        // 交互模式：用户手动选择单个源
        const selected = await promptUserSelect(reachable);
        let asset = selected.asset!;
        if (selected.source.key === 'ustc' && asset.checksum) {
          asset = { ...asset, checksum: await fetchChecksumFromUrl(asset.checksum).catch(() => '') };
        }
        try {
          const result = await this.tryDownloadJre(asset, platform.ext, selected.source.label);
          return result;
        } catch (err: any) {
          console.log(`   ${selected.source.label} 下载失败: ${err.message}`);
        }
      } else {
        // 自动模式：并发下载所有可达源，取最先完成的
        const result = await this.downloadRace(reachable, platform.ext);
        if (result) return result;
      }
    }

    // 8. 全部下载方式失败 → 降级到系统 JRE
    console.log('⚠️  自动下载失败，将尝试使用系统已有 JRE');
    return this.handleFallback(JRE_TARGET_VERSION);
  }

  /**
   * 尝试下载并安装 JRE，成功返回 JreInfo，失败返回 null
   */
  private async tryDownloadJre(asset: JreAsset, ext: string, sourceLabel: string, tmpFile?: string, signal?: AbortSignal): Promise<JreInfo> {
    const destDir = path.join(this.jreStorageDir, asset.version);
    const javaExe = path.join(destDir, 'bin',
      os.platform() === 'win32' ? 'java.exe' : 'java');
    const downloadTmp = tmpFile || path.join(this.jreStorageDir, `jre-${asset.version}.${ext}`);

    console.log(`   来源: ${sourceLabel}`);
    await downloadFileWithRetry(asset.downloadUrl, downloadTmp, signal);

    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });

    console.log('  正在校验 SHA256...');
    const valid = await this.verifyChecksum(downloadTmp, asset.checksum);
    if (!valid) {
      console.warn('⚠️  SHA256 校验未通过，继续使用（镜像文件可能尚在同步中）');
    } else {
      console.log('✓ SHA256 校验通过');
    }

    console.log('  正在解压...');
    await this.extractJre(downloadTmp, destDir);

    // 清理临时文件
    try { fs.unlinkSync(downloadTmp); } catch { /* ignore */ }

    // Unix: 确保 java 可执行
    if (os.platform() !== 'win32') {
      try { fs.chmodSync(javaExe, 0o755); } catch { /* ignore */ }
    }

    // 解压后验证 Java 可执行
    const detectedVersion = detectJavaVersion(javaExe);
    if (detectedVersion === null || detectedVersion < JRE_TARGET_VERSION) {
      const msg = `Java 版本验证失败 (检测到: ${detectedVersion ?? '无'}, 需要 >= ${JRE_TARGET_VERSION})`;
      console.log(`   ${msg}`);
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
      throw new Error(msg);
    }

    console.log(`✓ 解压完成: ${destDir} (Java ${detectedVersion})`);
    console.log('   JRE 就绪，正在启动 JDT LS...');
    console.log('');

    return {
      version: asset.version,
      path: destDir,
      javaExe,
      source: 'embedded',
    };
  }

  /**
   * 并发下载竞速：同时从所有可达源下载，取最先完成的
   * 其他未完成的下载会被中止并清理临时文件
   */
  private async downloadRace(reachable: JreProbeResult[], ext: string): Promise<JreInfo | null> {
    const ac = new AbortController();
    const labels = reachable.map(r => r.source.label).join(', ');
    console.log(`⬇ 并发下载 (${reachable.length} 个源): ${labels}`);

    const tempFiles: string[] = [];
    const seen = new Set<string>(); // 防止同版本多个源产生文件名冲突

    const tasks = reachable.map(async (r) => {
      let asset = r.asset!;
      // USTC checksum 是 URL，需要先获取
      if (r.source.key === 'ustc' && typeof asset.checksum === 'string' && asset.checksum.startsWith('http')) {
        asset = { ...asset, checksum: await fetchChecksumFromUrl(asset.checksum).catch(() => '') };
      }

      // 保证临时文件名唯一
      let suffix = r.source.key;
      let counter = 0;
      while (seen.has(suffix)) suffix = `${r.source.key}-${++counter}`;
      seen.add(suffix);

      const tmpFile = path.join(this.jreStorageDir, `jre-${asset.version}-${suffix}.${ext}`);
      tempFiles.push(tmpFile);

      return this.tryDownloadJre(asset, ext, r.source.label, tmpFile, ac.signal);
    });

    try {
      const winner = await Promise.any(tasks);
      return winner;
    } catch (e) {
      // AggregateError: 全部失败
      if (e instanceof AggregateError) {
        for (const err of e.errors) {
          if (err && typeof err === 'object' && 'message' in err && (err as any).name !== 'AbortError') {
            console.log(`   下载失败: ${(err as any).message}`);
          }
        }
      }
      return null;
    } finally {
      ac.abort();
      // 清理所有临时文件（成功的已在 tryDownloadJre 中删除）
      for (const f of tempFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
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
    }

    // 如果解压后只有一个中间目录，将其内容上移一层
    const entries = fs.readdirSync(destDir).filter(e => !e.startsWith('.'));
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

    console.error('');
    console.error('✗ 未找到兼容 JRE (需要 >= 21)');
    console.error('   Java 21 提供虚拟线程、分代 ZGC 等特性，性能更佳、内存占用更低');
    console.error('');
    console.error('   可通过以下方式获取 JRE:');
    console.error('');
    console.error('   1. 安装 VS Code 并安装 Red Hat Java 扩展 (内置 JRE)');
    console.error('   2. 手动下载 JRE 并放置到以下目录:');
    console.error(`      下载地址: https://github.com/adoptium/temurin21-binaries/releases`);
    console.error(`      清华镜像: ${TUNA_MIRROR_BASE}/21/jre/<arch>/<os>/`);
    console.error(`      中科大镜像: ${USTC_MIRROR_BASE}/releases/temurin21-binaries/LatestRelease/`);
    console.error(`      放置目录: ${this.jreStorageDir}/<version>/`);
    console.error('      (需包含 bin/java 或 bin/java.exe)');
    console.error('');
    throw new Error('未找到兼容 JRE (需要 >= 21)，请手动安装或安装 VS Code Java 扩展');
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
    // java -version writes to stderr; redirect to stdout for capture
    const output = execSync(`"${javaExe}" -version 2>&1`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    });
    return parseJavaVersion(output);
  } catch (err: any) {
    // exec may fail (file not found, etc.); stderr may contain version info
    const msg = err.stderr || err.stdout || '';
    if (msg) return parseJavaVersion(msg);
    return null;
  }
}

interface JreAsset {
  downloadUrl: string;
  checksum: string;
  size: number;
  version: string;
}

export interface JreSource {
  key: string;
  label: string;
  priority: number;
  probe(osName: string, archName: string): Promise<JreAsset>;
}

export interface JreProbeResult {
  source: JreSource;
  asset: JreAsset | null;
  latency: number;
  error?: string;
}

// ========== JRE 下载源定义 ==========

const tunaSource: JreSource = {
  key: 'tuna',
  label: 'TUNA 清华镜像',
  priority: 0,
  probe: fetchJreAssetFromTunaMirror,
};

const ustcSource: JreSource = {
  key: 'ustc',
  label: 'USTC 中科大镜像',
  priority: 1,
  probe: fetchJreAssetFromUstcMirror,
};

const githubSource: JreSource = {
  key: 'github',
  label: 'GitHub Releases',
  priority: 2,
  probe: fetchJreAssetFromGitHub,
};

const adoptiumSource: JreSource = {
  key: 'adoptium',
  label: 'Adoptium Official',
  priority: 3,
  probe: fetchJreAssetFromAdoptiumApi,
};

function getRegisteredSources(): JreSource[] {
  return [tunaSource, ustcSource, githubSource, adoptiumSource];
}

// ========== 并发探测 ==========

export async function probeAllSources(osName: string, archName: string): Promise<JreProbeResult[]> {
  const sources = getRegisteredSources();

  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const start = Date.now();
      const asset = await withTimeout(source.probe(osName, archName), PROBE_TIMEOUT_MS, source.label);
      return { source, asset, latency: Date.now() - start };
    })
  );

  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      source: sources[i],
      asset: null,
      latency: PROBE_TIMEOUT_MS,
      error: r.reason?.message || '未知错误',
    };
  });
}

export function selectBestSource(results: JreProbeResult[]): JreProbeResult {
  return [...results].sort((a, b) => {
    if (a.source.priority !== b.source.priority) return a.source.priority - b.source.priority;
    return a.latency - b.latency;
  })[0];
}

function promptUserSelect(results: JreProbeResult[]): Promise<JreProbeResult> {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('请选择下载源:');
    results.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.source.label.padEnd(20)} ${r.asset!.version.padEnd(14)} (${r.latency}ms)`);
    });

    rl.question(`\n输入编号 [1-${results.length}，默认 1]: `, (answer: string) => {
      rl.close();
      const idx = parseInt(answer.trim()) - 1;
      resolve(idx >= 0 && idx < results.length ? results[idx] : results[0]);
    });
  });
}

/**
 * 带超时的 Promise 包装
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时 (${ms / 1000}s)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * 从 Adoptium 官方 API 获取最新 JRE 21 资产信息
 * 在中国大陆通常不可达，超时后自动降级到镜像源
 */
export function fetchJreAssetFromAdoptiumApi(osName: string, archName: string, apiUrl?: string): Promise<JreAsset> {
  const endpoint = apiUrl || ADOPTIUM_API_ASSETS_URL;
  const client = endpoint.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    client.get(endpoint, {
      timeout: 5000,
      headers: { 'User-Agent': 'jdt-lsp-cli' },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Adoptium API returned HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try {
          const assets: any[] = JSON.parse(body);
          const match = assets.find((a: any) =>
            a.binary?.image_type === 'jre' &&
            a.binary?.os === osName &&
            a.binary?.architecture === archName
          );
          if (!match) {
            reject(new Error(`No JRE asset found on Adoptium API for ${osName} ${archName}`));
            return;
          }
          const pkg = match.binary.package;
          const semver: string = match.version?.semver || '21.0.0';
          const version = semver.replace(/\+/g, '_');
          resolve({
            downloadUrl: pkg.link,
            checksum: pkg.checksum || '',
            size: pkg.size || 0,
            version,
          });
        } catch (e: any) {
          reject(new Error(`Failed to parse Adoptium API response: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 从 GitHub Releases API 获取最新 JRE 21 资产信息
 */
function fetchJreAssetFromGitHub(osName: string, archName: string): Promise<JreAsset> {
  return withTimeout(new Promise((resolve, reject) => {
    https.get(GITHUB_API_RELEASES_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'jdt-lsp-cli' },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', async () => {
        try {
          const release = JSON.parse(body);
          const tagName: string = release.tag_name || '';
          const version = tagName.replace('jdk-', '').replace(/\+/g, '_');

          const ext = osName === 'windows' ? 'zip' : 'tar.gz';
          const assetPattern = `_${archName}_${osName}_hotspot_`;

          const assets: any[] = release.assets || [];
          const jreAsset = assets.find((a: any) =>
            a.name && a.name.includes('jre') && a.name.includes(assetPattern) && a.name.endsWith(`.${ext}`)
          );

          if (!jreAsset) {
            reject(new Error(`No JRE asset found for ${osName} ${archName}`));
            return;
          }

          // 获取 SHA256 校验文件内容
          let checksum = '';
          const shaAsset = assets.find((a: any) =>
            a.name === `${jreAsset.name}.sha256.txt`
          );
          if (shaAsset?.browser_download_url) {
            try {
              checksum = await fetchChecksumFromUrl(shaAsset.browser_download_url);
            } catch { /* 校验失败不阻塞 */ }
          }

          resolve({
            downloadUrl: jreAsset.browser_download_url,
            checksum,
            size: jreAsset.size || 0,
            version,
          });
        } catch (e: any) {
          reject(new Error(`Failed to parse GitHub API response: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  }), 15000, 'GitHub API');
}

/**
 * 从 .sha256.txt URL 获取校验值
 */
function fetchChecksumFromUrl(sha256Url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = sha256Url.startsWith('https:') ? https : http;
    client.get(sha256Url, { timeout: 15000, headers: { 'User-Agent': 'jdt-lsp-cli' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        const hex = body.trim().split(/\s+/)[0];
        if (hex.length === 64) resolve(hex);
        else reject(new Error('Invalid SHA256 format'));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 从 USTC 镜像获取 JRE 资产信息
 */
function fetchJreAssetFromUstcMirror(osName: string, archName: string): Promise<JreAsset> {
  const latestUrl = `${USTC_MIRROR_BASE}/releases/temurin21-binaries/LatestRelease/`;
  const ext = osName === 'windows' ? '.zip' : '.tar.gz';
  const assetPattern = `jre_${archName}_${osName}_hotspot_`;

  return new Promise((resolve, reject) => {
    const client = latestUrl.startsWith('https:') ? https : http;
    client.get(latestUrl, { timeout: 15000, headers: { 'User-Agent': 'jdt-lsp-cli' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`USTC mirror returned HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        // 从 HTML 目录列表中提取匹配的 JRE 文件名
        const hrefRe = /href="\/adoptium\/releases\/temurin21-binaries\/LatestRelease\/([^"]+)"/g;
        let match: RegExpExecArray | null;
        let jreFilename = '';
        let shaFilename = '';
        while ((match = hrefRe.exec(body)) !== null) {
          const name = match[1];
          if (name.includes(assetPattern) && name.endsWith(ext)) {
            jreFilename = name;
          }
          if (name.includes(assetPattern) && name.endsWith(`${ext}.sha256.txt`)) {
            shaFilename = name;
          }
        }

        if (!jreFilename) {
          reject(new Error(`No JRE asset found on USTC mirror for ${osName} ${archName}`));
          return;
        }

        // 从文件名提取版本号: OpenJDK21U-jre_x64_windows_hotspot_21.0.9_10.zip → 21.0.9_10
        const versionMatch = jreFilename.match(/_hotspot_([\d._]+)\./);
        const version = versionMatch ? versionMatch[1] : '21.0.0';

        resolve({
          downloadUrl: `${latestUrl}${jreFilename}`,
          checksum: shaFilename ? `${latestUrl}${shaFilename}` : '',
          size: 0,
          version,
        });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 从 TUNA (清华) 镜像获取 JRE 资产信息
 * 路径结构: /Adoptium/21/jre/{arch}/{os}/
 * TUNA 镜像同步及时、版本最新，但不提供 .sha256 校验文件
 */
function fetchJreAssetFromTunaMirror(osName: string, archName: string): Promise<JreAsset> {
  const dirUrl = `${TUNA_MIRROR_BASE}/21/jre/${archName}/${osName}/`;
  const ext = osName === 'windows' ? '.zip' : '.tar.gz';
  const assetPattern = `jre_${archName}_${osName}_hotspot_`;

  return new Promise((resolve, reject) => {
    const client = dirUrl.startsWith('https:') ? https : http;
    client.get(dirUrl, { timeout: 15000, headers: { 'User-Agent': 'jdt-lsp-cli' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`TUNA mirror returned HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        // TUNA 使用相对路径的 href，匹配 JRE 文件名
        const hrefRe = /href="(OpenJDK21U-[^"]+\.(?:zip|tar\.gz))"/g;
        let match: RegExpExecArray | null;
        let jreFilename = '';
        while ((match = hrefRe.exec(body)) !== null) {
          const name = match[1];
          if (name.includes(assetPattern) && name.endsWith(ext)) {
            jreFilename = name;
          }
        }

        if (!jreFilename) {
          reject(new Error(`No JRE asset found on TUNA mirror for ${osName} ${archName}`));
          return;
        }

        // 从文件名提取版本号: OpenJDK21U-jre_x64_windows_hotspot_21.0.11_10.zip → 21.0.11_10
        const versionMatch = jreFilename.match(/_hotspot_([\d._]+)\./);
        const version = versionMatch ? versionMatch[1] : '21.0.0';

        resolve({
          downloadUrl: `${dirUrl}${jreFilename}`,
          checksum: '',
          size: 0,
          version,
        });
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

/**
 * 带重试的下载，仅网络错误和 5xx 重试
 */
async function downloadFileWithRetry(url: string, dest: string, signal?: AbortSignal, maxRetries: number = DOWNLOAD_RETRY_MAX): Promise<void> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (attempt > 0) {
        const delay = DOWNLOAD_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`  重试 ${attempt}/${maxRetries} (${delay / 1000}s 后退)...`);
        await new Promise(r => setTimeout(r, delay));
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
      }
      await downloadFile(url, dest, signal);
      return;
    } catch (err: any) {
      lastErr = err;
      if (err.name === 'AbortError') throw err;
      if (!isRetryableError(err)) throw err;
    }
  }
  throw lastErr;
}

function isRetryableError(err: Error & { code?: string; statusCode?: number }): boolean {
  const networkCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN'];
  if (err.code && networkCodes.includes(err.code)) return true;
  if (err.statusCode && err.statusCode >= 500) return true;
  return false;
}

function downloadFile(url: string, dest: string, signal?: AbortSignal, onProgress?: (state: DownloadState) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const { protocol } = new URL(url);
    const client = protocol === 'https:' ? https : http;

    const req = client.get(url, { timeout: 300000, signal, headers: { 'User-Agent': 'jdt-lsp-cli' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          return downloadFile(redirectUrl, dest, signal, onProgress).then(resolve).catch(reject);
        }
      }

      if (res.statusCode !== 200) {
        const err: any = new Error(`Download failed: HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        reject(err);
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

      fileStream.on('error', (err) => { cleanupTemp(dest); reject(err); });
      res.on('error', (err) => { cleanupTemp(dest); reject(err); });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      cleanupTemp(dest);
      reject(err);
    });
  });
}

function cleanupTemp(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// 单例实例
let instance: EmbeddedJreManager | null = null;

export function getJreManager(): EmbeddedJreManager {
  if (!instance) instance = new EmbeddedJreManager();
  return instance;
}
