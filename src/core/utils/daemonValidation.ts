/**
 * Daemon 启动参数校验工具
 *
 * 提供三层防呆校验：
 * 1. CLI 前置校验（格式、范围、组合关系）
 * 2. 环境预检（JAVA_HOME、端口占用、目录权限）
 * 3. 运行时防御（项目有效性）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
  warnings?: string[];
}

/**
 * 校验端口号
 */
export function validatePort(portStr: string): ValidationResult {
  const port = parseInt(portStr, 10);

  if (isNaN(port) || String(port) !== String(parseFloat(portStr))) {
    return {
      valid: false,
      error: `端口 "${portStr}" 不是有效的整数`,
      suggestion: '请使用 1-65535 之间的端口号，例如: --port 9876',
    };
  }

  if (port < 1 || port > 65535) {
    return {
      valid: false,
      error: `端口 ${port} 超出有效范围 (1-65535)`,
      suggestion: '请使用 1024-65535 之间的端口避免系统冲突',
    };
  }

  if (port < 1024 && process.platform !== 'win32') {
    return {
      valid: false,
      error: `端口 ${port} 是系统保留端口，需要 root 权限`,
      suggestion: '请使用 1024-65535 之间的端口，例如: --port 9876',
    };
  }

  return { valid: true };
}

/**
 * 检测端口是否可用（未被占用）
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // 其他错误视为端口不可用
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * 校验项目路径
 */
export function validateProjectPath(projectPath: string): ValidationResult {
  if (!projectPath || projectPath.trim() === '') {
    return {
      valid: false,
      error: '项目路径不能为空',
      suggestion: '请指定有效的项目目录，例如: --init-project ./my-project',
    };
  }

  const resolved = path.resolve(projectPath);

  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      error: `项目路径不存在: ${resolved}`,
      suggestion: '请确认路径正确，或使用绝对路径',
    };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return {
      valid: false,
      error: `项目路径不是目录: ${resolved}`,
      suggestion: '请指定项目根目录（包含 pom.xml 或 build.gradle 的目录）',
    };
  }

  // 检查是否是有效 Java 项目（仅作提示，不卡点）
  const warnings: string[] = [];
  const hasPom = fs.existsSync(path.join(resolved, 'pom.xml'));
  const hasBuildGradle = fs.existsSync(path.join(resolved, 'build.gradle'));
  const hasBuildGradleKts = fs.existsSync(path.join(resolved, 'build.gradle.kts'));
  const hasSrc = fs.existsSync(path.join(resolved, 'src'));

  if (!hasPom && !hasBuildGradle && !hasBuildGradleKts) {
    warnings.push('未检测到 pom.xml 或 build.gradle，可能不是 Maven/Gradle 项目，JDT LS 初始化可能失败');
  }
  if (!hasSrc) {
    warnings.push('未检测到 src 目录，可能不是标准 Java 项目结构');
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * 校验 jdtlsPath
 */
export function validateJdtlsPath(jdtlsPath: string): ValidationResult {
  if (!jdtlsPath || jdtlsPath.trim() === '') {
    return {
      valid: false,
      error: 'JDT LS 路径不能为空',
      suggestion: '请指定 JDT LS 启动脚本路径，或使用内置自动查找',
    };
  }

  const resolved = path.resolve(jdtlsPath);

  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      error: `JDT LS 路径不存在: ${resolved}`,
      suggestion: '请检查路径是否正确，或省略 --jdtlsPath 让工具自动查找',
    };
  }

  return { valid: true };
}

/**
 * 环境预检（JAVA_HOME、目录权限、内存）
 *
 * 注意：内存预警仅作提示，不做卡点
 */
export function validateEnvironment(pidFile: string, logFile: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. JAVA_HOME 检查
  const javaHome = process.env.JAVA_HOME;
  if (!javaHome) {
    errors.push('JAVA_HOME 环境变量未设置，JDT LS 无法启动');
  } else {
    const javaHomeResolved = path.resolve(javaHome);
    if (!fs.existsSync(javaHomeResolved)) {
      errors.push(`JAVA_HOME 指向的目录不存在: ${javaHomeResolved}`);
    } else {
      const javaExe = process.platform === 'win32'
        ? path.join(javaHomeResolved, 'bin', 'java.exe')
        : path.join(javaHomeResolved, 'bin', 'java');
      if (!fs.existsSync(javaExe)) {
        errors.push(`JAVA_HOME 下未找到 java 可执行文件: ${javaExe}`);
      }
    }
  }

  // 2. PID 文件目录可写性
  const pidDir = path.dirname(pidFile);
  try {
    fs.accessSync(pidDir, fs.constants.W_OK);
  } catch {
    errors.push(`PID 文件目录不可写: ${pidDir}`);
  }

  // 3. 日志文件目录可写性
  const logDir = path.dirname(logFile);
  try {
    fs.accessSync(logDir, fs.constants.W_OK);
  } catch {
    errors.push(`日志文件目录不可写: ${logDir}`);
  }

  // 4. dataDir 根目录可写性
  const dataDirRoot = path.join(os.homedir(), '.jdt-lsp-cli', 'data');
  try {
    if (!fs.existsSync(dataDirRoot)) {
      fs.mkdirSync(dataDirRoot, { recursive: true });
    }
    fs.accessSync(dataDirRoot, fs.constants.W_OK);
  } catch {
    errors.push(`数据缓存目录不可写: ${dataDirRoot}`);
  }

  // 5. 内存预警（仅提示，不卡点）
  const totalMem = os.totalmem();
  const minMemGB = 2;
  const totalMemGB = Math.round(totalMem / (1024 * 1024 * 1024));
  if (totalMemGB < minMemGB) {
    warnings.push(`系统内存 ${totalMemGB}GB 较低，JDT LS 默认配置需要 ${minMemGB}GB 堆内存，可能导致性能问题`);
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: errors.join('; '),
      suggestion: '请修复上述环境问题后再启动守护进程',
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * 参数组合关系校验
 */
export function validateDaemonOptions(
  cmdOpts: {
    eager?: boolean;
    initProject?: string;
    wait?: boolean;
    port?: string;
  },
  globalOpts: {
    project?: string;
    jdtlsPath?: string;
  }
): ValidationResult {
  const warnings: string[] = [];

  // 1. 端口校验
  if (cmdOpts.port !== undefined) {
    const portResult = validatePort(cmdOpts.port);
    if (!portResult.valid) return portResult;
  }

  // 2. --wait 必须配合 --eager
  if (cmdOpts.wait && !cmdOpts.eager) {
    return {
      valid: false,
      error: '--wait 必须与 --eager 一起使用',
      suggestion: '示例: jls daemon start --eager --init-project . --wait',
    };
  }

  // 3. --init-project 路径校验（如果提供了）
  if (cmdOpts.initProject) {
    const projectResult = validateProjectPath(cmdOpts.initProject);
    if (!projectResult.valid) return projectResult;
    if (projectResult.warnings) {
      warnings.push(...projectResult.warnings);
    }
  }

  // 4. --eager 但没有 --init-project 时，检查 globalOpts.project
  if (cmdOpts.eager) {
    const effectiveProject = cmdOpts.initProject || globalOpts.project;
    if (!effectiveProject) {
      return {
        valid: false,
        error: '--eager 需要指定项目路径（通过 --init-project 或全局 --project）',
        suggestion: '示例: jls daemon start --eager --init-project ./my-project',
      };
    }
    // 校验 effectiveProject
    const projectResult = validateProjectPath(effectiveProject);
    if (!projectResult.valid) return projectResult;
    if (projectResult.warnings) {
      warnings.push(...projectResult.warnings);
    }
  }

  // 5. jdtlsPath 校验（如果提供了）
  if (globalOpts.jdtlsPath) {
    const jdtlsResult = validateJdtlsPath(globalOpts.jdtlsPath);
    if (!jdtlsResult.valid) return jdtlsResult;
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
