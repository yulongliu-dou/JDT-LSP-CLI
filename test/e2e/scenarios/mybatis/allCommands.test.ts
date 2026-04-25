/**
 * MyBatis-3 全命令覆盖 E2E 测试（Daemon 模式）
 * 
 * 测试所有 CLI 命令在 MyBatis 项目上的基本功能
 * 使用 daemon 模式共享 JDT LS 实例以加速测试
 */

import { execCLIWithDaemon, parseJSONOutput, MYBATIS_PROJECT, waitForDaemonReady, cleanupDaemon } from '../../../helpers/testUtils';

describe('MyBatis E2E - 全命令覆盖测试（Daemon 模式）', () => {
  
  // Daemon 生命周期管理
  beforeAll(async () => {
    console.log('\n=== Starting Daemon for allCommands Tests ===');
    await waitForDaemonReady(MYBATIS_PROJECT.path);
  }, 120000);

  afterAll(async () => {
    console.log('\n=== Cleaning Up Daemon ===');
    await cleanupDaemon();
  });

  describe('find 命令 - 全局符号搜索', () => {
    it('应该搜索 SqlSession 类', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SqlSession',
        '--kind', 'Class',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      expect(output.data.length).toBeGreaterThan(0);
    }, 60000);

    it('应该搜索 Configuration 类', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'Configuration',
        '--kind', 'Class',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('symbols 命令 - 获取文件符号', () => {
    it('应该获取 DefaultSqlSession 的所有符号', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'sym', MYBATIS_PROJECT.files.defaultSqlSession,
        '--flat',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      expect(output.data.length).toBeGreaterThan(0);
    }, 60000);

    it('应该获取 Executor 接口的符号', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'sym', MYBATIS_PROJECT.files.executorInterface,
        '--flat',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('definition 命令 - 跳转定义', () => {
    it('应该定位到 selectOne 方法定义', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'def', MYBATIS_PROJECT.files.defaultSqlSession,
        '--method', 'selectOne',
        '--index', '0',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该使用 signature 定位重载方法', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'def', MYBATIS_PROJECT.files.defaultSqlSession,
        '--method', 'selectList',
        '--signature', '(String)',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('references 命令 - 查找引用', () => {
    it('应该查找 selectOne 方法的引用', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'refs', MYBATIS_PROJECT.files.defaultSqlSession,
        '--method', 'selectOne',
        '--index', '0',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('hover 命令 - 悬停信息', () => {
    it('应该获取 selectOne 方法的文档', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'hover', MYBATIS_PROJECT.files.defaultSqlSession,
        '--method', 'selectOne',
        '--index', '0',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该获取 Configuration 类的信息', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'hover', MYBATIS_PROJECT.files.configuration,
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('implementations 命令 - 查找实现', () => {
    it('应该找到 SqlSession 接口的实现', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'impl', MYBATIS_PROJECT.files.sqlSessionInterface,
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      expect(output.data.length).toBeGreaterThanOrEqual(1);
    }, 60000);
  });

  describe('type-definition 命令 - 类型跳转', () => {
    it('应该获取方法的类型定义', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'typedef', MYBATIS_PROJECT.files.defaultSqlSession,
        '--method', 'selectOne',
        '--index', '0',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('输出格式选项', () => {
    it('应该支持 JSON 紧凑输出', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SqlSession',
        '--kind', 'Class',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该支持普通 JSON 输出', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SqlSession',
        '--kind', 'Class'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });
});
