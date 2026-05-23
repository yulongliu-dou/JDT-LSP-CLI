import * as http from 'http';
import {
  buildAdoptiumUrl,
  fetchJreAsset,
} from '../../../../src/jdt/embedded/jreManager';
import { getAdoptiumPlatform } from '../../../../src/jdt/embedded/jreConstants';

describe('fetchJreAsset', () => {
  let server: http.Server;
  let serverUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.includes('/v3/assets/latest/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{
          binary: {
            package: {
              link: 'http://localhost:19999/mock-jre.zip',
              name: 'mock-jre.zip',
              size: 1024,
              checksum: 'abc123',
            },
          },
          version: { semver: '21.0.5+11' },
        }]));
      } else if (req.url === '/empty') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      } else if (req.url === '/invalid') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"not": "an array"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(19998, '127.0.0.1', () => resolve());
    });
    serverUrl = 'http://127.0.0.1:19998';
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches JRE asset from mock API', async () => {
    const apiUrl = `${serverUrl}/v3/assets/latest/21/hotspot?image_type=jre&project=jdk&vendor=eclipse&os=linux&arch=x64`;
    const asset = await fetchJreAsset(apiUrl);

    expect(asset.downloadUrl).toBe('http://localhost:19999/mock-jre.zip');
    expect(asset.checksum).toBe('abc123');
    expect(asset.size).toBe(1024);
    expect(asset.version).toBe('21.0.5+11');
  });

  it('rejects on empty response', async () => {
    await expect(fetchJreAsset(`${serverUrl}/empty`)).rejects.toThrow('No JRE asset found');
  });

  it('rejects on invalid JSON (non-array)', async () => {
    await expect(fetchJreAsset(`${serverUrl}/invalid`)).rejects.toThrow('No JRE asset found');
  });

  it('rejects on non-200 response', async () => {
    await expect(fetchJreAsset(`${serverUrl}/nonexistent`)).rejects.toThrow();
  });
});

describe('getAdoptiumPlatform', () => {
  it('returns valid platform mapping', () => {
    const plat = getAdoptiumPlatform();
    expect(['windows', 'mac', 'linux']).toContain(plat.os);
    expect(['x64', 'aarch64']).toContain(plat.arch);
    expect(['zip', 'tar.gz']).toContain(plat.ext);
  });
});

describe('buildAdoptiumUrl', () => {
  it('url starts with API base', () => {
    const url = buildAdoptiumUrl('linux', 'x64');
    expect(url).toContain('https://api.adoptium.net/v3/assets/latest/21/hotspot');
  });
});
