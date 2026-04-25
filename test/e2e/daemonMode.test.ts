/**
 * Daemon 模式测试
 * 
 * 验证 daemon 模式的性能优化效果
 */

import { 
  DaemonManager, 
  execCLIWithDaemon, 
  waitForDaemonReady, 
  cleanupDaemon,
  parseJSONOutput,
  MYBATIS_PROJECT 
} from '../helpers/testUtils';

describe('Daemon Mode E2E Tests', () => {
  const daemon = DaemonManager.getInstance();

  beforeAll(async () => {
    console.log('\n=== Starting Daemon for Tests ===');
    await waitForDaemonReady(MYBATIS_PROJECT.path, { debug: true });
  }, 120000);

  afterAll(async () => {
    console.log('\n=== Cleaning Up Daemon ===');
    await cleanupDaemon();
  });

  describe('Daemon Lifecycle', () => {
    it('should start daemon successfully', () => {
      const info = daemon.getInfo();
      expect(info.running).toBe(true);
      expect(info.port).toBeGreaterThan(0);
      expect(info.project).toBe(MYBATIS_PROJECT.path);
    });

    it('should pass health check', async () => {
      const healthy = await daemon.checkHealth();
      expect(healthy).toBe(true);
    });
  });

  describe('Daemon Mode Performance', () => {
    it('should execute find command via daemon', async () => {
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SqlSession',
        '--kind', 'Class',
        '--json-compact'
      ], { debug: true });

      const output = parseJSONOutput(result.stdout);
      expect(output.success).toBe(true);
      expect(output.data.length).toBeGreaterThan(0);
    }, 30000);

    it('should execute second command faster (daemon reuse)', async () => {
      const startTime = Date.now();
      const result = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'Configuration',
        '--kind', 'Class',
        '--json-compact'
      ]);

      const elapsed = Date.now() - startTime;
      const output = parseJSONOutput(result.stdout);

      console.log(`\n[Performance] Second command took: ${elapsed}ms`);
      
      expect(output.success).toBe(true);
      // Daemon 模式下应该比冷启动快（< 15秒）
      expect(elapsed).toBeLessThan(15000);
    }, 30000);

    it('should execute multiple commands with shared daemon', async () => {
      const commands = [
        ['find', 'Executor', '--kind', 'Interface'],
        ['find', 'BaseBuilder', '--kind', 'Class'],
        ['find', 'Cache', '--kind', 'Interface'],
      ];

      const startTime = Date.now();
      
      for (const cmd of commands) {
        const result = await execCLIWithDaemon([
          '-p', MYBATIS_PROJECT.path,
          ...cmd,
          '--json-compact'
        ]);
        const output = parseJSONOutput(result.stdout);
        expect(output.success).toBe(true);
      }

      const totalElapsed = Date.now() - startTime;
      const avgTime = totalElapsed / commands.length;

      console.log(`\n[Performance] ${commands.length} commands via daemon:`);
      console.log(`  Total: ${totalElapsed}ms`);
      console.log(`  Average: ${avgTime}ms/command`);

      // 平均每个命令应该 < 10秒（daemon 复用）
      expect(avgTime).toBeLessThan(10000);
    }, 60000);
  });

  describe('Daemon vs No-Daemon Comparison', () => {
    it('should show performance difference', async () => {
      const { execCLI } = await import('../helpers/testUtils');

      // Daemon 模式
      const daemonStart = Date.now();
      await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SqlSession',
        '--json-compact'
      ]);
      const daemonTime = Date.now() - daemonStart;

      // No-Daemon 模式（需要导入 execCLI）
      const noDaemonStart = Date.now();
      await execCLI([
        '-p', MYBATIS_PROJECT.path,
        'find', 'SqlSession',
        '--json-compact'
      ]);
      const noDaemonTime = Date.now() - noDaemonStart;

      console.log('\n=== Performance Comparison ===');
      console.log(`Daemon mode: ${daemonTime}ms`);
      console.log(`No-Daemon mode: ${noDaemonTime}ms`);
      console.log(`Improvement: ${Math.round((1 - daemonTime / noDaemonTime) * 100)}%`);

      // Daemon 模式应该更快
      expect(daemonTime).toBeLessThan(noDaemonTime);
    }, 120000);
  });
});
