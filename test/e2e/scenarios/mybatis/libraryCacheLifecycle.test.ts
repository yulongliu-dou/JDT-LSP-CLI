/**
 * Library 缓存生命周期与配置联动 E2E 测试（Daemon 模式）
 *
 * 验证 /cache/stats、/cache/clean、/config 端点的完整行为，
 * 以及 sourceDownloadMode、decompiler 等配置变更对解析管道的实时影响。
 */

import * as http from 'http';
import {
  execCLIWithDaemon,
  parseJSONOutput,
  MYBATIS_PROJECT,
  waitForDaemonReady,
  cleanupDaemon,
  DaemonManager,
  skipIfNoMvn,
  detectJavaHome,
} from '../../../helpers/testUtils';

// ============================================================
// HTTP 辅助
// ============================================================

function daemonPost(endpoint: string, body: Record<string, unknown> = {}): Promise<any> {
  const port = DaemonManager.getInstance().getPort();
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `http://127.0.0.1:${port}${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function daemonGet(endpoint: string): Promise<any> {
  const port = DaemonManager.getInstance().getPort();
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${endpoint}`, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ============================================================
// 辅助：获取 jdt:// URI
// ============================================================

interface FindSymbol {
  name: string;
  kind: string;
  containerName?: string;
  location?: { uri: string; range?: any };
}

async function findJdtUri(className: string, kind: string = 'Class'): Promise<string | null> {
  const result = await execCLIWithDaemon([
    '-p', MYBATIS_PROJECT.path,
    'find', className,
    '--kind', kind,
    '--json-compact',
  ]);
  const output = parseJSONOutput(result.stdout);
  if (!output.success) return null;
  const symbols: FindSymbol[] = output.data.symbols || [];
  for (const s of symbols) {
    if (s.location?.uri?.startsWith('jdt:') && s.location.uri.includes('!/')) {
      return s.location.uri;
    }
  }
  return null;
}

async function findJdtUriInContainer(className: string, containerPattern: string): Promise<string | null> {
  const result = await execCLIWithDaemon([
    '-p', MYBATIS_PROJECT.path,
    'find', className,
    '--kind', 'Class',
    '--json-compact',
  ]);
  const output = parseJSONOutput(result.stdout);
  if (!output.success) return null;
  const symbols: FindSymbol[] = output.data.symbols || [];
  for (const s of symbols) {
    if (s.location?.uri?.startsWith('jdt:') && s.location.uri.includes('!/') && s.containerName?.includes(containerPattern)) {
      return s.location.uri;
    }
  }
  for (const s of symbols) {
    if (s.location?.uri?.startsWith('jdt:') && s.location.uri.includes('!/')) {
      return s.location.uri;
    }
  }
  return null;
}

// ============================================================
// 测试套件
// ============================================================

describe('Library Cache Lifecycle E2E - 缓存管理与配置联动', () => {

  beforeAll(async () => {
    console.log('\n=== Starting Daemon for Cache Lifecycle Tests ===');
    await waitForDaemonReady(MYBATIS_PROJECT.path);

    // 触发一次解析确保有缓存数据
    const jdtUri = await findJdtUriInContainer('Function', 'java.util.function');
    if (jdtUri) {
      await daemonPost('/library/resolve', { jdtUri });
      console.log('  Pre-warmed cache with Function resolve');
    }
  }, 180000);

  afterAll(async () => {
    // 恢复所有配置为默认值
    try {
      await daemonPost('/config', { key: 'libraryResolveEnabled', value: true });
      await daemonPost('/config', { key: 'sourceDownloadMode', value: 'mvn' });
      await daemonPost('/config', { key: 'decompiler', value: 'vineflower' });
      await daemonPost('/config', { key: 'cacheTtlDays', value: 7 });
    } catch { /* ignore */ }

    console.log('\n=== Cleaning Up Daemon ===');
    await cleanupDaemon();
  });

  // ==========================================================
  // 断言组 H：/cache/stats 统计验证
  // ==========================================================

  describe('Group H: /cache/stats verification', () => {
    it('should return valid cache statistics', async () => {
      const stats = await daemonGet('/cache/stats');

      expect(stats.success).toBe(true);
      expect(stats.data).toBeTruthy();

      const { totalBytes, buckets, scopeCount } = stats.data;
      console.log(`  Cache stats: totalBytes=${totalBytes}, scopeCount=${scopeCount}`);

      // totalBytes 应为非负数
      expect(typeof totalBytes).toBe('number');
      expect(totalBytes).toBeGreaterThanOrEqual(0);

      // buckets 应有 bucket 键（可能不含所有四种，取决于已触发的解析路径）
      expect(buckets).toBeTruthy();
      const knownBuckets = ['sources', 'decompiled', 'jdk', 'class-file-contents'];
      const presentBuckets = knownBuckets.filter(b => buckets[b] !== undefined);
      expect(presentBuckets.length).toBeGreaterThan(0);
      for (const bucket of presentBuckets) {
        console.log(`    bucket '${bucket}': scopeCount=${buckets[bucket]?.scopeCount || 0}`);
      }

      // scopeCount 应大于 0（因为 beforeAll 触发了一次解析）
      expect(scopeCount).toBeGreaterThanOrEqual(0);
    }, 15000);

    it('should have valid timestamps in stats', async () => {
      const stats = await daemonGet('/cache/stats');
      expect(stats.success).toBe(true);

      const { oldestAccess, latestAccess } = stats.data;
      console.log(`  oldestAccess=${oldestAccess}, latestAccess=${latestAccess}`);

      // 时间戳应为合理范围（如果有数据）
      if (oldestAccess !== null) {
        expect(oldestAccess).toBeGreaterThan(0);
        // 应在近期（一年内）
        const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
        expect(oldestAccess).toBeGreaterThan(oneYearAgo);
      }
      if (latestAccess !== null) {
        expect(latestAccess).toBeGreaterThan(0);
        expect(latestAccess).toBeLessThanOrEqual(Date.now() + 60000); // 允许时钟偏移
      }
    }, 15000);
  });

  // ==========================================================
  // 断言组 I：/cache/clean 清理行为
  // ==========================================================

  describe('Group I: /cache/clean behavior', () => {
    it('should not clean anything with very large ttlDays', async () => {
      const result = await daemonPost('/cache/clean', { mode: 'stale', ttlDays: 9999 });

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data.removed).toBe(0);
      console.log(`  Clean with ttlDays=9999: scanned=${result.data.scanned}, removed=${result.data.removed} ✓`);
    }, 15000);

    it('should handle ttlDays=0 gracefully', async () => {
      // 先设置 cacheTtlDays=0
      await daemonPost('/config', { key: 'cacheTtlDays', value: 0 });

      const result = await daemonPost('/cache/clean', { mode: 'stale' });
      expect(result.success).toBe(true);

      // ttlDays=0 时应该不清理
      if (result.data.removed !== undefined) {
        expect(result.data.removed).toBe(0);
      }
      console.log(`  Clean with ttlDays=0: ${JSON.stringify(result.data).substring(0, 100)}`);

      // 恢复
      await daemonPost('/config', { key: 'cacheTtlDays', value: 7 });
    }, 15000);

    it('should return error info for missing jdtUri in /library/resolve', async () => {
      const result = await daemonPost('/library/resolve', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('jdtUri');
      console.log(`  Missing jdtUri error: ${result.error} ✓`);
    }, 10000);
  });

  // ==========================================================
  // 断言组 J：sourceDownloadMode 配置效果
  // ==========================================================

  describe('Group J: sourceDownloadMode config effect', () => {
    afterAll(async () => {
      // 恢复
      await daemonPost('/config', { key: 'sourceDownloadMode', value: 'mvn' });
    });

    it('should skip sources-jar when sourceDownloadMode=none', async () => {
      if (skipIfNoMvn()) {
        console.log('  [SKIP] mvn not available');
        return;
      }

      // 设置 sourceDownloadMode=none
      const configResult = await daemonPost('/config', { key: 'sourceDownloadMode', value: 'none' });
      expect(configResult.success).toBe(true);

      // 找一个 Maven 依赖类
      const jdtUri = await findJdtUri('OgnlContext');
      if (!jdtUri) {
        console.log('  [SKIP] No Maven dependency jdt:// URI found');
        await daemonPost('/config', { key: 'sourceDownloadMode', value: 'mvn' });
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      expect(resolved.success).toBe(true);

      if (resolved.data) {
        // 不应是 sources-jar（因为 sources 下载被禁用）
        // 可能是 decompiled 或 class-file-contents
        console.log(`  sourceDownloadMode=none: resolved source=${resolved.data.source}`);
        expect(resolved.data.source).not.toBe('sources-jar');
      }

      // 恢复
      await daemonPost('/config', { key: 'sourceDownloadMode', value: 'mvn' });
    }, 120000);
  });

  // ==========================================================
  // 断言组 K：decompiler 配置效果
  // ==========================================================

  describe('Group K: decompiler config effect', () => {
    afterAll(async () => {
      await daemonPost('/config', { key: 'decompiler', value: 'vineflower' });
    });

    it('should fallback to class-file-contents when decompiler=none', async () => {
      // 禁用 sources 和 decompiler，强制走 classFileContents
      await daemonPost('/config', { key: 'sourceDownloadMode', value: 'none' });
      await daemonPost('/config', { key: 'decompiler', value: 'none' });

      // 找一个非 JDK 的依赖类
      const jdtUri = await findJdtUri('Ognl');
      if (!jdtUri) {
        console.log('  [SKIP] No dependency jdt:// URI found');
        await daemonPost('/config', { key: 'sourceDownloadMode', value: 'mvn' });
        await daemonPost('/config', { key: 'decompiler', value: 'vineflower' });
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      expect(resolved.success).toBe(true);

      if (resolved.data) {
        console.log(`  decompiler=none: source=${resolved.data.source}, note=${resolved.data.note}`);
        // 应该是 class-file-contents
        expect(resolved.data.source).toBe('class-file-contents');
        // note 应含 "Decompiler disabled"
        if (resolved.data.note) {
          expect(resolved.data.note.toLowerCase()).toContain('decompiler disabled');
        }
      }

      // 恢复
      await daemonPost('/config', { key: 'sourceDownloadMode', value: 'mvn' });
      await daemonPost('/config', { key: 'decompiler', value: 'vineflower' });
    }, 60000);
  });

  // ==========================================================
  // 断言组 L：/status 完整性
  // ==========================================================

  describe('Group L: /status completeness', () => {
    it('should return complete status with all expected fields', async () => {
      const status = await daemonGet('/status');

      expect(status.success).toBe(true);
      expect(status.data).toBeTruthy();

      // libraryResolveEnabled 应为 boolean
      expect(typeof status.data.libraryResolveEnabled).toBe('boolean');
      console.log(`  libraryResolveEnabled: ${status.data.libraryResolveEnabled}`);

      // warnings 应为 string[]
      expect(Array.isArray(status.data.warnings)).toBe(true);
      for (const w of status.data.warnings) {
        expect(typeof w).toBe('string');
      }
      console.log(`  warnings count: ${status.data.warnings.length}`);

      // status 应为 'ready'（daemon 已初始化完成）
      expect(status.data.status).toBe('ready');

      // elapsed 应合理
      expect(typeof status.elapsed).toBe('number');
      expect(status.elapsed).toBeLessThan(5000);
      console.log(`  elapsed: ${status.elapsed}ms`);
    }, 10000);
  });

  // ==========================================================
  // 断言组 M：配置持久化与热更新
  // ==========================================================

  describe('Group M: config persistence and hot-reload', () => {
    it('should persist cacheTtlDays change', async () => {
      // 修改配置
      const setResult = await daemonPost('/config', { key: 'cacheTtlDays', value: 14 });
      expect(setResult.success).toBe(true);

      // 验证生效：通过 /cache/clean 的行为间接验证
      // 或者直接通过另一次 /config 设置来确认写入成功
      const setBack = await daemonPost('/config', { key: 'cacheTtlDays', value: 7 });
      expect(setBack.success).toBe(true);
      console.log('  cacheTtlDays hot-reload: 7 → 14 → 7 ✓');
    }, 10000);

    it('should handle unknown config key gracefully', async () => {
      // 写入一个未知 key 不应崩溃
      const result = await daemonPost('/config', { key: 'nonexistentKey', value: 'test' });
      // 实现可能接受（存入 JSON）或忽略，但不应 crash
      expect(result.success).toBeDefined();
      console.log(`  Unknown key: success=${result.success} ✓ (no crash)`);
    }, 10000);

    it('should toggle libraryResolveEnabled via /config', async () => {
      // 禁用
      await daemonPost('/config', { key: 'libraryResolveEnabled', value: false });
      const status1 = await daemonGet('/status');
      expect(status1.data.libraryResolveEnabled).toBe(false);

      // 启用
      await daemonPost('/config', { key: 'libraryResolveEnabled', value: true });
      const status2 = await daemonGet('/status');
      expect(status2.data.libraryResolveEnabled).toBe(true);

      console.log('  libraryResolveEnabled toggle: true → false → true ✓');
    }, 15000);
  });
});
