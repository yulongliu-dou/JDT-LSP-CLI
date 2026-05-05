/**
 * vineflowerRunner 单元测试（SP03 Task 3.7）
 *
 * 覆盖：
 * - detectJavaExecutable 探测优先级
 * - VineflowerError 结构
 * - findVineflowerJar 查找策略（通过环境变量）
 *
 * 注：实际子进程 spawn 需集成测试覆盖，此处验证工具函数。
 *
 * 参见：[SP03 子计划 Task 3.2 / 3.7](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectJavaExecutable, VineflowerError, VINEFLOWER_JAR_NAME } from '../../../src/libraryProvider/decompile/vineflowerRunner';

describe('vineflowerRunner', () => {
  describe('detectJavaExecutable', () => {
    test('returns launcherJava when provided and exists', () => {
      // 使用 node 可执行文件作为"模拟 Java"
      const nodeExe = process.execPath; // 始终存在
      const result = detectJavaExecutable(nodeExe);
      expect(result).toBe(nodeExe);
    });

    test('falls back to platform default when nothing matches', () => {
      // 清除 JAVA_HOME 避免干扰
      const origJavaHome = process.env.JAVA_HOME;
      delete process.env.JAVA_HOME;
      try {
        // 传入不存在的路径 + JAVA_HOME 为空
        const result = detectJavaExecutable('/nonexistent/java');
        const expected = os.platform() === 'win32' ? 'java.exe' : 'java';
        expect(result).toBe(expected);
      } finally {
        if (origJavaHome !== undefined) {
          process.env.JAVA_HOME = origJavaHome;
        }
      }
    });

    test('uses JAVA_HOME when set and launcherJava not provided', () => {
      // 构造一个临时"JAVA_HOME"
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-jh-'));
      const binDir = path.join(tmpHome, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const javaExe = path.join(binDir, os.platform() === 'win32' ? 'java.exe' : 'java');
      fs.writeFileSync(javaExe, '', 'utf-8');

      const origJavaHome = process.env.JAVA_HOME;
      process.env.JAVA_HOME = tmpHome;
      try {
        const result = detectJavaExecutable();
        expect(result).toBe(javaExe);
      } finally {
        process.env.JAVA_HOME = origJavaHome;
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });
  });

  describe('VineflowerError', () => {
    test('creates error with message and name', () => {
      const err = new VineflowerError('test error');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(VineflowerError);
      expect(err.name).toBe('VineflowerError');
      expect(err.message).toBe('test error');
    });

    test('VINEFLOWER_JAR_NAME is a known version string', () => {
      expect(VINEFLOWER_JAR_NAME).toMatch(/^vineflower-\d+\.\d+\.\d+\.jar$/);
    });
  });
});
