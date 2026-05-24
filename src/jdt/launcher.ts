/**
 * JDT LS 启动器
 * 
 * 负责：
 * - 查找 JDT LS 路径
 * - 查找内嵌 Java Runtime
 * - 构建 JVM 参数
 * - 启动 Java 进程
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { JvmConfig, CLIOptions } from '../core/types';
import { createSpawnOptions } from '../core/utils/processUtils';
import { loadConfig, DEFAULT_JVM_CONFIG } from './configLoader';
import { getJreManager } from './embedded/jreManager';
import { getJdtlsManager } from './embedded/jdtlsManager';


export interface JdtLaunchResult {
  process: ChildProcess;
  jdtlsPath: string;
  launcherJar: string;
  dataDir: string;
}

export class JdtLauncher {
  private javaExecutable = 'java';
  private jvmConfig: JvmConfig;
  private options: CLIOptions;
  private jreInitPromise: Promise<void> | null = null;

  constructor(options: CLIOptions, jvmConfig?: Partial<JvmConfig>) {
    this.options = {
      timeout: 60000,
      verbose: false,
      ...options,
    };
    
    // 合并 JVM 配置
    const config = loadConfig();
    this.jvmConfig = { ...config.jvm, ...jvmConfig };
  }

  /**
   * 日志输出
   */
  private log(message: string, ...args: any[]) {
    if (this.options.verbose) {
      console.error(`[JDT-LAUNCHER] ${message}`, ...args);
    }
  }

  /**
   * 构建 JVM 参数
   */
  buildJvmArgs(): string[] {
    const args: string[] = [];
    const cfg = this.jvmConfig;

    // macOS headless fix: 防止 Activity Monitor 显示"未响应"
    args.push('-Djava.awt.headless=true');

    // 内存配置
    args.push(`-Xms${cfg.xms}`);
    args.push(`-Xmx${cfg.xmx}`);

    // G1 垃圾收集器
    if (cfg.useG1GC) {
      args.push('-XX:+UseG1GC');
      args.push(`-XX:MaxGCPauseMillis=${cfg.maxGCPauseMillis}`);

      // 字符串去重（仅 G1GC 支持）
      if (cfg.useStringDeduplication) {
        args.push('-XX:+UseStringDeduplication');
      }

      // G1 空闲周期 GC — 触发 heap shrink 的前提 (JDK 12+)
      if (cfg.g1PeriodicGCIntervalMs > 0) {
        args.push(`-XX:G1PeriodicGCInterval=${cfg.g1PeriodicGCIntervalMs}`);
      }
    }

    // 堆空闲比例控制 — 控制何时收缩/扩容堆
    if (cfg.maxHeapFreeRatio > 0) {
      args.push(`-XX:MaxHeapFreeRatio=${cfg.maxHeapFreeRatio}`);
    }
    if (cfg.minHeapFreeRatio > 0) {
      args.push(`-XX:MinHeapFreeRatio=${cfg.minHeapFreeRatio}`);
    }

    // 元数据区上限 — 防止无限膨胀
    if (cfg.maxMetaspaceSize) {
      args.push(`-XX:MaxMetaspaceSize=${cfg.maxMetaspaceSize}`);
    }

    // 软引用清理策略
    if (cfg.softRefLRUPolicyMSPerMB > 0) {
      args.push(`-XX:SoftRefLRUPolicyMSPerMB=${cfg.softRefLRUPolicyMSPerMB}`);
    }

    // 额外参数
    if (cfg.extraArgs && cfg.extraArgs.length > 0) {
      args.push(...cfg.extraArgs);
    }

    return args;
  }

  /**
   * 查找 JDT LS 路径
   * 优先级: --jdtls-path > 内嵌 ~/.jdt-lsp-cli/jdtls/<version>/ > VS Code 扩展 > 错误
   */
  findJdtLsPath(): string {
    // 1. 用户指定路径
    if (this.options.jdtlsPath && fs.existsSync(this.options.jdtlsPath)) {
      return this.options.jdtlsPath;
    }

    // 2. 内嵌 JDT LS
    try {
      const jdtlsManager = getJdtlsManager();
      const cached = jdtlsManager.getCachedJdtls();
      if (cached) {
        this.log('Using embedded JDT LS:', cached.path);
        return cached.path;
      }
    } catch { /* 降级 */ }

    // 3. VS Code / Qoder 扩展
    const extBases = [
      path.join(os.homedir(), '.vscode', 'extensions'),
      path.join(os.homedir(), '.vscode-server', 'extensions'),
      path.join(os.homedir(), '.qoder', 'extensions'),
    ];

    for (const basePath of extBases) {
      if (!fs.existsSync(basePath)) continue;
      try {
        const dirs = fs.readdirSync(basePath);
        const javaExtDir = dirs.find(d => d.startsWith('redhat.java-'));
        if (javaExtDir) {
          const serverPath = path.join(basePath, javaExtDir, 'server');
          if (fs.existsSync(serverPath)) {
            this.log('Found VS Code JDT LS:', serverPath);
            console.log('检测到 VS Code Java 扩展中的 JDT LS，复用中...');
            return serverPath;
          }
        }
      } catch { /* continue */ }
    }

    // 4. 都不行
    throw new Error(
      'Cannot find eclipse.jdt.ls.\n\n' +
      '请运行 `jls jdt update` 重新安装内嵌 JDT LS，\n' +
      '或使用 `--jdtls-path` 指定路径。\n'
    );
  }

  /**
   * 查找扩展自带的 Java Runtime
   */
  findBundledJava(extPath: string): void {
    const jrePath = path.join(extPath, 'jre');
    if (!fs.existsSync(jrePath)) {
      this.log('No bundled JRE found, using system Java');
      return;
    }

    // 查找 jre 目录下的 Java 版本目录
    const jreDirs = fs.readdirSync(jrePath);
    for (const jreDir of jreDirs) {
      const javaExe = path.join(jrePath, jreDir, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(javaExe)) {
        this.javaExecutable = javaExe;
        this.log('Found bundled Java:', javaExe);
        return;
      }
    }
  }

  /**
   * 查找 jdt.ls launcher jar
   */
  findLauncherJar(jdtlsPath: string): string {
    const pluginsDir = path.join(jdtlsPath, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      throw new Error(`Plugins directory not found: ${pluginsDir}`);
    }

    const files = fs.readdirSync(pluginsDir);
    const launcher = files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
    if (!launcher) {
      throw new Error('Cannot find equinox launcher jar');
    }

    return path.join(pluginsDir, launcher);
  }

  /**
   * 获取配置目录
   */
  getConfigDir(jdtlsPath: string): string {
    const platform = os.platform();
    let configName = 'config_linux';
    if (platform === 'win32') {
      configName = 'config_win';
    } else if (platform === 'darwin') {
      configName = 'config_mac';
    }
    return path.join(jdtlsPath, configName);
  }

  /**
   * 递归复制目录
   */
  copyDirSync(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 初始化 JRE（确保有可用 Java，在 launch 前调用）
   */
  private async initJre(): Promise<void> {
    const jreManager = getJreManager();
    const jreInfo = await jreManager.ensure();
    this.javaExecutable = jreInfo.javaExe;
    this.log('Using Java:', this.javaExecutable, `(source: ${jreInfo.source})`);
  }

  /**
   * 初始化 JDT LS（确保有可用 JDT LS，在 launch 前调用）
   */
  private async initJdtls(): Promise<void> {
    if (this.options.jdtlsPath) {
      this.log('Using user-specified JDT LS path:', this.options.jdtlsPath);
      return;
    }

    const jdtlsManager = getJdtlsManager();
    try {
      const jdtlsInfo = await jdtlsManager.ensure();
      this.options.jdtlsPath = jdtlsInfo.path;
      this.log('JDT LS ready:', jdtlsInfo.path, `(source: ${jdtlsInfo.source})`);
    } catch (err: any) {
      console.error('JDT LS 初始化失败:', err.message);
      throw err;
    }
  }

  /**
   * 启动 JDT LS 进程
   */
  async launch(): Promise<JdtLaunchResult> {
    // 确保 JRE 就绪
    if (!this.jreInitPromise) {
      this.jreInitPromise = this.initJre();
    }
    await this.jreInitPromise;

    // 确保 JDT LS 就绪
    await this.initJdtls();

    const jdtlsPath = this.findJdtLsPath();
    const launcherJar = this.findLauncherJar(jdtlsPath);
    const configDir = this.getConfigDir(jdtlsPath);
    const timestamp = Date.now();
    const dataDir = this.options.dataDir || path.join(os.tmpdir(), `jdt-lsp-cli-data-${timestamp}`);

    this.log('Starting JDT LS...');
    this.log('  JDT LS Path:', jdtlsPath);
    this.log('  Launcher:', launcherJar);
    this.log('  Shared Config:', configDir);
    this.log('  Data:', dataDir);
    this.log('  Project:', this.options.projectPath);
    this.log('  Java:', this.javaExecutable);

    // 确保数据目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 构建 JVM 参数
    const jvmArgs = this.buildJvmArgs();
    this.log('JVM Config:', this.jvmConfig);

    // 构建启动参数 (参考 jdtls.py)
    const javaArgs = [
      // JVM 内存与 GC 参数
      ...jvmArgs,
      // Eclipse/OSGi 参数
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dosgi.checkConfiguration=true',
      `-Dosgi.sharedConfiguration.area=${configDir}`,
      '-Dosgi.sharedConfiguration.area.readOnly=true',
      '-Dosgi.configuration.cascaded=true',
      // Java 模块系统参数
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      // Launcher
      '-jar', launcherJar,
      '-data', dataDir,
    ];

    // 启动进程
    const process = spawn(this.javaExecutable, javaArgs, {
      cwd: this.options.projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, // Windows: 隐藏 Java 进程的控制台窗口
    });

    // 错误输出
    process.stderr?.on('data', (data) => {
      this.log('STDERR:', data.toString());
    });

    process.on('error', (err) => {
      console.error('Failed to start JDT LS:', err);
    });

    process.on('exit', (code) => {
      this.log('JDT LS exited with code:', code);
    });

    return {
      process,
      jdtlsPath,
      launcherJar,
      dataDir,
    };
  }

  /**
   * 获取 Java 可执行文件路径
   */
  getJavaExecutable(): string {
    return this.javaExecutable;
  }
}
