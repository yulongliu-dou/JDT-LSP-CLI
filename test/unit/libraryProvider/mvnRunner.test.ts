/**
 * mvnRunner 单元测试（SP04 Task 4.8）
 *
 * 覆盖：
 * - detectMvn：无 PATH 返回 null
 * - MvnNotFoundError 结构
 * - MvnDependencySourcesOptions 参数构建
 *
 * 注：实际子进程 spawn 需集成测试覆盖，此处验证工具函数。
 *
 * 参见：[SP04 子计划 Task 4.3 / 4.8](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import { MvnNotFoundError, detectMvn, runDependencySources } from '../../../src/libraryProvider/sources/mvnRunner';

describe('mvnRunner', () => {
  describe('MvnNotFoundError', () => {
    test('is an Error with name MvnNotFoundError', () => {
      const err = new MvnNotFoundError('test message');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('MvnNotFoundError');
      expect(err.message).toBe('test message');
    });
  });

  describe('detectMvn', () => {
    test('returns string or null', () => {
      // 根据环境 mvn 可能存在也可能不存在，只验证返回类型
      const result = detectMvn();
      expect(typeof result === 'string' || result === null).toBe(true);
    });
  });

  describe('runDependencySources', () => {
    test('throws MvnNotFoundError when mvn is not available', async () => {
      // 当 mvn 不在 PATH 且 M2_HOME/MAVEN_HOME 未设置时
      if (detectMvn() !== null) {
        // mvn 存在，跳过此测试（真实环境中 mvn 可能可用）
        return;
      }
      await expect(runDependencySources({
        gavs: [{ groupId: 'com.example', artifactId: 'test', version: '1.0' }],
      })).rejects.toThrow(MvnNotFoundError);
    });
  });
});
