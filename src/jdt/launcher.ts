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
   */
  findJdtLsPath(): string {
    // 1. 使用用户指定的路径
    if (this.options.jdtlsPath && fs.existsSync(this.options.jdtlsPath)) {
      return this.options.jdtlsPath;
    }

    // 2. 检查常见的安装位置
    const possiblePaths = [
      // VS Code Red Hat Java extension
      path.join(os.homedir(), '.vscode', 'extensions'),
      path.join(os.homedir(), '.vscode-server', 'extensions'),
      // Qoder (VS Code based IDE)
      path.join(os.homedir(), '.qoder', 'extensions'),
      // 环境变量
      process.env.JDTLS_HOME,
      // 常见安装路径
      '/usr/share/java/jdtls',
      '/opt/jdtls',
    ].filter(Boolean) as string[];

    for (const basePath of possiblePaths) {
      if (!fs.existsSync(basePath)) continue;

      // 查找 redhat.java 扩展
      const dirs = fs.readdirSync(basePath);
      const javaExtDir = dirs.find(d => d.startsWith('redhat.java-'));
      if (javaExtDir) {
        const extPath = path.join(basePath, javaExtDir);
        const jdtlsPath = path.join(extPath, 'server');
        if (fs.existsSync(jdtlsPath)) {
          // 检查扩展是否自带 Java Runtime
          this.findBundledJava(extPath);
          return jdtlsPath;
        }
      }
    }

    throw new Error(
      'Cannot find eclipse.jdt.ls. Please specify --jdtls-path or install Red Hat Java extension in VS Code'
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
   * 启动 JDT LS 进程
   */
  async launch(): Promise<JdtLaunchResult> {
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
