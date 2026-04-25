/**
 * MyBatis-3 Executor 层次结构 E2E 测试（Daemon 模式）
 * 
 * 测试 Executor 接口及其实现类的查找和调用链
 * 使用 daemon 模式共享 JDT LS 实例以加速测试
 */

import { execCLIWithDaemon, parseJSONOutput, MYBATIS_PROJECT, waitForDaemonReady, cleanupDaemon } from '../../../helpers/testUtils';

describe('MyBatis E2E - Executor 层次结构（Daemon 模式）', () => {
  // Daemon 生命周期管理
  beforeAll(async () => {
    console.log('\n=== Starting Daemon for Executor Tests ===');
    await waitForDaemonReady(MYBATIS_PROJECT.path);
  }, 120000);

  afterAll(async () => {
    console.log('\n=== Cleaning Up Daemon ===');
    await cleanupDaemon();
  });

  describe('Executor 接口实现查找', () => {
    it('应该找到 Executor 接口的所有实现', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'impl', MYBATIS_PROJECT.files.executorInterface,
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      
      expect(output.success).toBe(true);
      expect(Array.isArray(output.data)).toBe(true);
      expect(output.data.length).toBeGreaterThanOrEqual(4); // 至少4个实现
    }, 60000);

    it('应该找到 BaseExecutor 的子类', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'impl', MYBATIS_PROJECT.files.baseExecutor,
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('Executor 方法定义跳转', () => {
    it('应该定位到 SimpleExecutor 的 query 方法', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'def', MYBATIS_PROJECT.files.simpleExecutor,
        '--method', 'query',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该定位到 CachingExecutor 的 query 方法', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'def', MYBATIS_PROJECT.files.cachingExecutor,
        '--method', 'query',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('Executor 调用链分析', () => {
    it('应该分析 SimpleExecutor.query 的调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', MYBATIS_PROJECT.files.simpleExecutor,
        '--method', 'query',
        '--incoming',
        '-d', '2',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该分析 BaseExecutor.doQuery 的 outgoing 调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', MYBATIS_PROJECT.files.baseExecutor,
        '--method', 'doQuery',
        '-d', '3',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('Executor 符号搜索', () => {
    it('应该搜索到 Executor 接口', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'Executor',
        '--kind', 'Interface',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      expect(output.data.length).toBeGreaterThan(0);
    }, 60000);

    it('应该搜索到 SimpleExecutor 类', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SimpleExecutor',
        '--kind', 'Class',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });
});
