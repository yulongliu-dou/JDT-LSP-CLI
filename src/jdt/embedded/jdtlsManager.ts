/**
 * 内嵌 JDT LS 管理器
 *
 * 负责:
 * - 管理内嵌 JDT LS (~/.jdt-lsp-cli/jdtls/<version>/)
 * - 从 npm 包内置 tar.gz 解压安装
 * - 降级到 VS Code 扩展或手动指引
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { ensureDir } from '../../core/utils/fileUtils';
import {
  JDTLS_STORAGE_DIR,
  JDTLS_DEFAULT_VERSION,
  getPackageJdtlsDir,
} from './jdtlsConstants';

export interface JdtlsInfo {
  path: string;
  version: string;
  source: 'embedded' | 'redhat' | 'manual';
  launcherJar: string;
  size: string;
  ready: boolean;
}

export interface JdtlsStatus {
  source: string;
  version: string;
  path: string;
  size: string;
  ready: boolean;
}

export class EmbeddedJdtlsManager {
  private readonly storageDir: string;

  constructor() {
    this.storageDir = JDTLS_STORAGE_DIR;
    ensureDir(this.storageDir);
  }

  /**
   * 确保有可用的 JDT LS（主入口）
   * 优先级: 本地缓存 → npm 包内置 tar.gz → VS Code 扩展 → 错误指引
   */
  async ensure(): Promise<JdtlsInfo> {
    // 1. 检查本地缓存
    const cached = this.getCachedJdtls();
    if (cached) return cached;

    // 2. 从 npm 包内置 tar.gz 解压
    try {
      const fromPkg = await this.extractFromPackage();
      if (fromPkg) return fromPkg;
    } catch { /* 继续降级 */ }

    // 3. 降级: VS Code 扩展
    const vscodePath = this.findVsCodeJdtls();
    if (vscodePath) {
      console.log('检测到 VS Code Java 扩展，可复用其中 JDT LS');
      console.log(`路径: ${vscodePath}`);
      const info = this.validateJdtls(vscodePath, 'unknown');
      if (info) {
        info.source = 'redhat';
        return info;
      }
    }

    // 4. 全部失败 → 抛出错误
    this.printManualGuide();
    throw new Error('未找到可用的 JDT LS，请检查包完整性或使用 `--jdtls-path` 指定路径');
  }

  /**
   * 获取 JDT LS 状态
   */
  async getStatus(): Promise<JdtlsStatus> {
    const cached = this.getCachedJdtls();
    if (cached) {
      return {
        source: `embedded (${cached.version})`,
        version: cached.version,
        path: cached.path,
        size: cached.size,
        ready: true,
      };
    }
    return { source: 'none', version: '-', path: '-', size: '-', ready: false };
  }

  /**
   * 移除所有内嵌 JDT LS
   */
  async remove(): Promise<void> {
    if (!fs.existsSync(this.storageDir)) return;
    const entries = fs.readdirSync(this.storageDir);
    for (const entry of entries) {
      const fullPath = path.join(this.storageDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      } catch { /* skip */ }
    }
  }

  /**
   * 从 npm 包内置 tar.gz 重新解压安装
   */
  async update(): Promise<JdtlsInfo> {
    // 清除旧版本
    await this.remove();

    console.log('正在从内置包解压 JDT LS...');
    const info = await this.extractFromPackage();
    if (!info) {
      throw new Error('内置 JDT LS 包不存在或已损坏，请重新安装 npm 包');
    }
    console.log(`✓ JDT LS ${info.version} 就绪 (${info.size})`);
    return info;
  }

  // ========== 内部方法 ==========

  /**
   * 扫描 ~/.jdt-lsp-cli/jdtls/ 下所有版本目录，返回最新有效版本
   */
  getCachedJdtls(): JdtlsInfo | null {
    if (!fs.existsSync(this.storageDir)) return null;

    const versions: string[] = [];
    try {
      const entries = fs.readdirSync(this.storageDir);
      for (const entry of entries) {
        const fullPath = path.join(this.storageDir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          versions.push(entry);
        }
      }
    } catch { return null; }

    // semver 降序排列
    versions.sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return nb - na;
      }
      return 0;
    });
    for (const version of versions) {
      const vpath = path.join(this.storageDir, version);
      const info = this.validateJdtls(vpath, version);
      if (info) return info;
    }

    return null;
  }

  /**
   * 验证 JDT LS 目录结构是否有效
   */
  private validateJdtls(dirPath: string, version: string): JdtlsInfo | null {
    const pluginsDir = path.join(dirPath, 'plugins');
    if (!fs.existsSync(pluginsDir)) return null;

    let launcherJar = '';
    try {
      const files = fs.readdirSync(pluginsDir);
      const launcher = files.find(
        f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar')
      );
      if (!launcher) return null;
      launcherJar = path.join(pluginsDir, launcher);
    } catch { return null; }

    let size = '未知';
    try {
      size = this.calcDirSize(dirPath);
    } catch { /* keep unknown */ }

    return {
      path: dirPath,
      version,
      source: 'embedded',
      launcherJar,
      size,
      ready: true,
    };
  }

  /**
   * 计算目录大小（可读格式）
   */
  private calcDirSize(dirPath: string): string {
    let total = 0;
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fp);
        else {
          try { total += fs.statSync(fp).size; } catch { /* skip */ }
        }
      }
    };
    walk(dirPath);
    return `${(total / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * 从 npm 包内置 tar.gz 解压
   */
  private async extractFromPackage(): Promise<JdtlsInfo | null> {
    const pkgDir = getPackageJdtlsDir();
    if (!fs.existsSync(pkgDir)) return null;

    const tarFiles = fs.readdirSync(pkgDir).filter(f => f.endsWith('.tar.gz'));
    if (tarFiles.length === 0) return null;

    const tarFile = path.join(pkgDir, tarFiles[0]);
    const versionJsonPath = path.join(pkgDir, 'version.json');
    let version = JDTLS_DEFAULT_VERSION;
    if (fs.existsSync(versionJsonPath)) {
      try {
        const vj = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
        version = vj.version || version;
      } catch { /* use default */ }
    }

    const destDir = path.join(this.storageDir, version);
    if (fs.existsSync(destDir) && this.validateJdtls(destDir, version)) {
      return this.validateJdtls(destDir, version);
    }

    console.log(`正在解压内置 JDT LS ${version}...`);
    await this.extractTarGz(tarFile, destDir);
    console.log(`✓ JDT LS ${version} 解压完成`);

    return this.validateJdtls(destDir, version);
  }

  /**
   * 解压 tar.gz 文件
   */
  private async extractTarGz(archivePath: string, destDir: string): Promise<void> {
    ensureDir(destDir);
    const tarArchive = archivePath.replace(/\\/g, '/');
    const tarDest = destDir.replace(/\\/g, '/');
    // Windows 盘符中的 : 被 tar 误解为远程主机名，需 --force-local；macOS/Linux 的 tar 不支持此选项
    const isWindows = process.platform === 'win32';
    const tarCmd = isWindows
      ? `tar --force-local -xzf "${tarArchive}" -C "${tarDest}"`
      : `tar -xzf "${tarArchive}" -C "${tarDest}"`;
    execSync(tarCmd, {
      stdio: 'pipe',
      timeout: 120000,
    });

    // 如解压后只有一个中间目录，将其内容上移一层
    const entries = fs.readdirSync(destDir).filter(e => !e.startsWith('.'));
    if (entries.length === 1) {
      const innerDir = path.join(destDir, entries[0]);
      if (fs.statSync(innerDir).isDirectory()) {
        // NOTE: 若将来 extractTarGz 被并发调用同一 destDir，此临时目录名可能冲突
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

  /**
   * 查找 VS Code / Qoder 中的 JDT LS
   */
  private findVsCodeJdtls(): string | null {
    const extBases = [
      path.join(os.homedir(), '.vscode', 'extensions'),
      path.join(os.homedir(), '.vscode-server', 'extensions'),
      path.join(os.homedir(), '.qoder', 'extensions'),
    ];

    for (const extBase of extBases) {
      try {
        if (!fs.existsSync(extBase)) continue;
        const dirs = fs.readdirSync(extBase);
        const javaExt = dirs.find(d => d.startsWith('redhat.java-'));
        if (!javaExt) continue;
        const serverPath = path.join(extBase, javaExt, 'server');
        if (fs.existsSync(serverPath)) return serverPath;
      } catch { /* skip */ }
    }

    return null;
  }

  /**
   * 打印手动下载指引
   */
  private printManualGuide(): void {
    console.error('');
    console.error('✗ 未找到可用的 JDT LS');
    console.error('');
    console.error('请确保 npm 包内置了 JDT LS tar.gz:');
    console.error('');
    console.error(`  期望位置: ${getPackageJdtlsDir()}/jdt-language-server-*.tar.gz`);
    console.error(`  目标目录: ${this.storageDir}/<version>/`);
    console.error('  (需包含 plugins/org.eclipse.equinox.launcher_*.jar)');
    console.error('');
    console.error('运行 `npm install` 或 `jls jdt update` 重新安装');
    console.error('');
  }
}

// 单例实例
let instance: EmbeddedJdtlsManager | null = null;

export function getJdtlsManager(): EmbeddedJdtlsManager {
  if (!instance) instance = new EmbeddedJdtlsManager();
  return instance;
}
