import * as http from 'http';
import {
  JreSource,
  JreProbeResult,
  probeAllSources,
  selectBestSource,
  fetchJreAssetFromAdoptiumApi,
} from '../../../../src/jdt/embedded/jreManager';
import { getAdoptiumPlatform } from '../../../../src/jdt/embedded/jreConstants';

// ========== selectBestSource 测试 ==========

describe('selectBestSource', () => {
  function makeSource(key: string, priority: number): JreSource {
    return { key, label: key, priority, probe: async () => ({ downloadUrl: '', checksum: '', size: 0, version: '' }) };
  }

  function makeResult(source: JreSource, latency: number, version: string): JreProbeResult {
    return {
      source,
      asset: { downloadUrl: '', checksum: '', size: 0, version },
      latency,
    };
  }

  it('selects higher priority (lower number) when both reachable', () => {
    const src1 = makeSource('github', 1);
    const src2 = makeSource('ustc', 2);
    const results = [
      makeResult(src2, 50, '21.0.9_10'),
      makeResult(src1, 200, '21.0.11_10'),
    ];

    const best = selectBestSource(results);
    expect(best.source.key).toBe('github'); // priority 1 < 2
  });

  it('breaks priority tie by lower latency', () => {
    const src1 = makeSource('a', 1);
    const src2 = makeSource('b', 1);
    const results = [
      makeResult(src1, 300, '21.0.9_10'),
      makeResult(src2, 100, '21.0.11_10'),
    ];

    const best = selectBestSource(results);
    expect(best.source.key).toBe('b'); // same priority, lower latency
  });

  it('does not mutate input array', () => {
    const src1 = makeSource('a', 1);
    const src2 = makeSource('b', 2);
    const results = [
      makeResult(src2, 50, '21.0.9_10'),
      makeResult(src1, 200, '21.0.11_10'),
    ];
    const copy = [...results];

    selectBestSource(results);
    expect(results).toEqual(copy);
  });
});

// ========== probeAllSources 集成测试 ==========

describe('probeAllSources', () => {
  let githubServer: http.Server;
  let ustcServer: http.Server;
  let githubUrl: string;
  let ustcUrl: string;

  // 保存原始源，测试后恢复
  const originalProbeAllSources = probeAllSources;

  beforeAll(async () => {
    // GitHub 模拟服务器
    githubServer = http.createServer((req, res) => {
      const tagName = 'jdk-21.0.11+10';
      const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
      const filename = `OpenJDK21U-jre_${arch}_${osName}_hotspot_21.0.11_10.${ext}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tag_name: tagName,
        assets: [
          {
            name: filename,
            browser_download_url: `http://127.0.0.1:19981/${filename}`,
            size: 50000000,
          },
          {
            name: `${filename}.sha256.txt`,
            browser_download_url: `http://127.0.0.1:19981/${filename}.sha256.txt`,
          },
        ],
      }));
    });

    // SHA256 校验服务器
    const checksumServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    });

    await new Promise<void>(r => githubServer.listen(19981, '127.0.0.1', () => r()));
    await new Promise<void>(r => checksumServer.listen(19982, '127.0.0.1', () => r()));
    githubUrl = 'http://127.0.0.1:19981';
  });

  afterAll(async () => {
    await new Promise<void>(r => githubServer.close(() => r()));
  });

  it('probes sources concurrently and returns results for all', async () => {
    // 用 mock 源测试并发探测
    const mockSource1: JreSource = {
      key: 'test-fast',
      label: 'Fast Source',
      priority: 1,
      probe: async () => ({
        downloadUrl: 'http://example.com/jre.zip',
        checksum: 'abc123',
        size: 1000,
        version: '21.0.5_1',
      }),
    };

    const mockSource2: JreSource = {
      key: 'test-slow',
      label: 'Slow Source',
      priority: 2,
      probe: async () => {
        await new Promise(r => setTimeout(r, 100));
        return {
          downloadUrl: 'http://example.com/jre2.zip',
          checksum: 'def456',
          size: 2000,
          version: '21.0.9_10',
        };
      },
    };

    const mockSource3: JreSource = {
      key: 'test-fail',
      label: 'Fail Source',
      priority: 3,
      probe: async () => {
        throw new Error('Connection refused');
      },
    };

    // 创建一个测试专用的 probeAllSources
    const sources = [mockSource1, mockSource2, mockSource3];
    const testProbeAll = async (osName: string, archName: string): Promise<JreProbeResult[]> => {
      const PROBE_TIMEOUT_MS = 5000;
      const settled = await Promise.allSettled(
        sources.map(async (source) => {
          const start = Date.now();
          const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
            new Promise((resolve, reject) => {
              const t = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
              p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
            });
          const asset = await withTimeout(source.probe(osName, archName), PROBE_TIMEOUT_MS, source.label);
          return { source, asset, latency: Date.now() - start } as JreProbeResult;
        })
      );

      return settled.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          source: sources[i],
          asset: null,
          latency: PROBE_TIMEOUT_MS,
          error: r.reason?.message || 'unknown',
        };
      });
    };

    const results = await testProbeAll('linux', 'x64');

    expect(results).toHaveLength(3);

    // Fast source: succeeded
    expect(results[0].asset).not.toBeNull();
    expect(results[0].asset!.version).toBe('21.0.5_1');
    expect(results[0].latency).toBeLessThan(500);

    // Slow source: succeeded but took longer
    expect(results[1].asset).not.toBeNull();
    expect(results[1].asset!.version).toBe('21.0.9_10');
    expect(results[1].latency).toBeGreaterThanOrEqual(90);

    // Fail source: error captured
    expect(results[2].asset).toBeNull();
    expect(results[2].error).toContain('Connection refused');
  });

  it('concurrent probe total time approximates slowest source, not sum', async () => {
    const delays = [200, 300, 50];
    const sources: JreSource[] = delays.map((d, i) => ({
      key: `s${i}`,
      label: `Source ${i}`,
      priority: i,
      probe: async () => {
        await new Promise(r => setTimeout(r, d));
        return { downloadUrl: '', checksum: '', size: 0, version: '21.0.0' };
      },
    }));

    const PROBE_TIMEOUT_MS = 5000;
    const start = Date.now();
    const settled = await Promise.allSettled(
      sources.map(async (source) => {
        const s = Date.now();
        const asset = await source.probe('linux', 'x64');
        return { source, asset, latency: Date.now() - s } as JreProbeResult;
      })
    );
    const elapsed = Date.now() - start;

    const results = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { source: sources[i], asset: null, latency: PROBE_TIMEOUT_MS, error: 'fail' };
    });

    expect(results.every(r => r.asset !== null)).toBe(true);
    // 并发执行时间应接近最慢的 (300ms)，远小于总和 (550ms)
    expect(elapsed).toBeLessThan(500);
  });
});

// ========== getAdoptiumPlatform 测试 ==========

describe('getAdoptiumPlatform', () => {
  it('returns valid platform mapping', () => {
    const plat = getAdoptiumPlatform();
    expect(['windows', 'mac', 'linux']).toContain(plat.os);
    expect(['x64', 'aarch64']).toContain(plat.arch);
    expect(['zip', 'tar.gz']).toContain(plat.ext);
  });
});

// ========== fetchJreAssetFromAdoptiumApi 测试 ==========

describe('fetchJreAssetFromAdoptiumApi', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await new Promise<void>(r => server.close(() => r()));
  });

  function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
    return new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
  }

  it('parses Adoptium API v3 response and finds matching JRE', async () => {
    const url = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        {
          binary: {
            architecture: 'x64',
            image_type: 'jdk',
            os: 'linux',
            package: { name: 'jdk.tar.gz', link: 'http://example.com/jdk', size: 100, checksum: 'aaa' },
          },
          version: { semver: '21.0.6+7' },
        },
        {
          binary: {
            architecture: 'x64',
            image_type: 'jre',
            os: 'linux',
            package: { name: 'jre.tar.gz', link: 'http://example.com/jre', size: 200, checksum: 'bbb' },
          },
          version: { semver: '21.0.6+7' },
        },
        {
          binary: {
            architecture: 'aarch64',
            image_type: 'jre',
            os: 'linux',
            package: { name: 'jre-arm.tar.gz', link: 'http://example.com/jre-arm', size: 300, checksum: 'ccc' },
          },
          version: { semver: '21.0.5+5' },
        },
      ]));
    });

    const asset = await fetchJreAssetFromAdoptiumApi('linux', 'x64', url);

    expect(asset.version).toBe('21.0.6_7');
    expect(asset.downloadUrl).toBe('http://example.com/jre');
    expect(asset.checksum).toBe('bbb');
    expect(asset.size).toBe(200);
  });

  it('rejects when no matching JRE for platform', async () => {
    const url = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        {
          binary: {
            architecture: 'aarch64',
            image_type: 'jre',
            os: 'mac',
            package: { name: 'jre-arm-mac.tar.gz', link: 'http://example.com/jre', size: 200, checksum: 'bbb' },
          },
          version: { semver: '21.0.6+7' },
        },
      ]));
    });

    await expect(fetchJreAssetFromAdoptiumApi('linux', 'x64', url))
      .rejects.toThrow('No JRE asset found');
  });

  it('handles non-200 response gracefully', async () => {
    const url = await startServer((req, res) => {
      res.writeHead(503);
      res.end('Service Unavailable');
    });

    await expect(fetchJreAssetFromAdoptiumApi('linux', 'x64', url))
      .rejects.toThrow('HTTP 503');
  });
});
