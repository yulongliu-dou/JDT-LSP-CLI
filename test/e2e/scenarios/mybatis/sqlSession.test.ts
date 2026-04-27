/**
 * MyBatis-3 SqlSession 核心调用链 E2E 测试（Daemon 模式）
 * 
 * 测试 DefaultSqlSession 的核心方法调用链
 * 使用 daemon 模式共享 JDT LS 实例以加速测试
 */

import * as path from 'path';
import { execCLIWithDaemon, parseJSONOutput, MYBATIS_PROJECT, validateCallHierarchy, waitForDaemonReady, cleanupDaemon } from '../../../helpers/testUtils';

describe('MyBatis E2E - SqlSession 核心调用链（Daemon 模式）', () => {
  const sqlSessionFile = MYBATIS_PROJECT.files.defaultSqlSession;

  // Daemon 生命周期管理
  beforeAll(async () => {
    console.log('\n=== Starting Daemon for SqlSession Tests ===');
    await waitForDaemonReady(MYBATIS_PROJECT.path);
  }, 120000);

  afterAll(async () => {
    console.log('\n=== Cleaning Up Daemon ===');
    await cleanupDaemon();
  });

  describe('selectOne 方法调用链', () => {
    it('应该获取 selectOne(String) 的 outgoing 调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectOne',
        '--index', '0',
        '-d', '3',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      
      expect(output.success).toBe(true);
      expect(output.data.entry).toBeDefined();
      expect(output.data.entry.name).toContain('selectOne');
      expect(Array.isArray(output.data.calls)).toBe(true);
    }, 60000);

    it('应该获取 selectOne 的 incoming 调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectOne',
        '--index', '0',
        '--incoming',
        '-d', '2',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      
      expect(output.success).toBe(true);
    }, 60000);

    it('应该使用 signature 区分 selectOne 重载', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectOne',
        '--signature', '(String)',
        '-d', '2',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('selectList 方法调用链', () => {
    it('应该获取 selectList 的调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectList',
        '--index', '0',
        '-d', '3',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      
      expect(output.success).toBe(true);
      expect(output.data.calls?.length).toBeGreaterThan(0);
    }, 60000);

    it('应该使用不同深度获取调用链', async () => {
      const depths = [1, 2, 3];
      
      for (const depth of depths) {
        const result = await execCLIWithDaemon([
          '-p', MYBATIS_PROJECT.path,
          'ch', sqlSessionFile,
          '--method', 'selectList',
          '--index', '0',
          '-d', depth.toString(),
          '--json-compact'
        ]);

        const output = parseJSONOutput(result.stdout);
        expect(output.success).toBe(true);
      }
    }, 120000);
  });

  describe('insert/update/delete 方法调用链', () => {
    it('应该获取 insert 方法的调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'insert',
        '--index', '0',
        '-d', '2',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该获取 update 方法的调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'update',
        '--index', '0',
        '-d', '2',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该获取 delete 方法的调用链', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'delete',
        '--index', '0',
        '-d', '2',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);
  });

  describe('调用链 AI 友好模式', () => {
    it('应该使用 summary 模式获取摘要', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectOne',
        '--index', '0',
        '--mode', 'summary',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
    }, 60000);

    it('应该使用 lazy 模式获取初始结果', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'ch', sqlSessionFile,
        '--method', 'selectOne',
        '--index', '0',
        '--mode', 'lazy',
        '-d', '5',
        '--json-compact'
      ]);

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      expect(output.data.cursor).toBeDefined();
    }, 60000);

    it('应该使用 snapshot 模式生成快照', async () => {
      const snapshotPath = path.join(__dirname, '..', '..', '..', 'test-output', 'snapshot-' + Date.now());
      
      try {
        const result = await execCLIWithDaemon([
          '-p', MYBATIS_PROJECT.path,
          'ch', sqlSessionFile,
          '--method', 'selectOne',
          '--index', '0',
          '--mode', 'snapshot',
          '--snapshot-path', snapshotPath,
          '--json-compact'
        ]);

        const output = parseJSONOutput(result.stdout);
        expect(output.success).toBe(true);
      } finally {
        // 清理快照
        const fs = await import('fs');
        if (fs.existsSync(snapshotPath)) {
          fs.rmSync(snapshotPath, { recursive: true, force: true });
        }
      }
    }, 90000);
  });
});
