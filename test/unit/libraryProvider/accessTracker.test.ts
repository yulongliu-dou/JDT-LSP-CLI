/**
 * accessTracker 单元测试（SP02 Task 2.10）
 *
 * 覆盖：
 * - touch → 内存 Map 更新 + append access.log
 * - _resetForTest 后 getMaxTimestamp 能从 access.log 回放
 * - compact 去重后仅保留每 scope 最大时间戳
 * - flush 将内存 Map 写入 `<scope>/.lastaccess`
 *
 * 参见 SP02 Task 2.3 / Task 2.10
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../../src/libraryProvider/platform/pathUtils', () => {
  const actual = jest.requireActual('../../../src/libraryProvider/platform/pathUtils');
  const nodePath = jest.requireActual('path');
  return {
    ...actual,
    getLspCacheRoot: () => nodePath.join((global as any).__LP_TEST_HOME__ ?? '', '.lsp-cache'),
  };
});

import * as accessTracker from '../../../src/libraryProvider/cache/accessTracker';
import * as globalCache from '../../../src/libraryProvider/cache/globalCache';

describe('accessTracker', () => {
  let tmpHome: string;

  const accessLogPath = () => path.join(tmpHome, '.lsp-cache', 'global', 'access.log');

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-at-'));
    (global as any).__LP_TEST_HOME__ = tmpHome;
    accessTracker._resetForTest();
  });

  afterEach(() => {
    accessTracker._resetForTest();
    (global as any).__LP_TEST_HOME__ = undefined;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('touch updates memory map and appends access.log', () => {
    accessTracker.touch('jdk', '21/java.base');

    const snap = accessTracker.snapshot();
    expect(snap.get('jdk/21/java.base')).toBeGreaterThan(0);

    const raw = fs.readFileSync(accessLogPath(), 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^\d+\|jdk\/21\/java\.base$/);
  });

  test('getMaxTimestamp replays access.log after reset', async () => {
    accessTracker.touch('sources', 'g-a-v');
    const expected = accessTracker.snapshot().get('sources/g-a-v')!;
    expect(expected).toBeGreaterThan(0);

    // 模拟进程重启：清空内存 Map，强制下次从磁盘回放
    accessTracker._resetForTest();
    // 直接调用 getMaxTimestamp 触发 ensureReplayed，从 access.log 重建 memMap
    const ts = await accessTracker.getMaxTimestamp('sources', 'g-a-v');
    expect(ts).toBe(expected);
  });

  test('compact dedupes access.log to max timestamp per scope', async () => {
    // 手工构造多条历史记录（同一 scope 多个时间戳）
    fs.mkdirSync(path.dirname(accessLogPath()), { recursive: true });
    const lines = [
      '1000|jdk/21/java.base',
      '2000|sources/g-a-v',
      '3000|jdk/21/java.base',
      '1500|sources/g-a-v',
      '2500|decompiled/g-a-v',
    ];
    fs.writeFileSync(accessLogPath(), lines.join('\n') + '\n', 'utf-8');

    await accessTracker.compact();

    const raw = fs.readFileSync(accessLogPath(), 'utf-8');
    const kept = raw.split(/\r?\n/).filter(Boolean);
    expect(kept.length).toBe(3);

    const map = new Map<string, number>();
    for (const line of kept) {
      const idx = line.indexOf('|');
      map.set(line.slice(idx + 1), Number(line.slice(0, idx)));
    }
    expect(map.get('jdk/21/java.base')).toBe(3000);
    expect(map.get('sources/g-a-v')).toBe(2000);
    expect(map.get('decompiled/g-a-v')).toBe(2500);
  });

  test('flush writes .lastaccess into existing scope directory', async () => {
    // 先写一个 scope 文件，保证 scope 目录存在
    await globalCache.write('jdk', '21/java.base', 'java.util.List', 'class List {}');
    accessTracker.touch('jdk', '21/java.base');
    const ts = accessTracker.snapshot().get('jdk/21/java.base')!;

    await accessTracker.flush();

    const lastaccess = path.join(
      tmpHome, '.lsp-cache', 'global', 'jdk', '21', 'java.base', '.lastaccess'
    );
    expect(fs.existsSync(lastaccess)).toBe(true);
    expect(Number(fs.readFileSync(lastaccess, 'utf-8').trim())).toBe(ts);
  });

  test('getMaxTimestamp reads .lastaccess when memory map cold', async () => {
    // 直接写 .lastaccess，不 touch
    const dir = path.join(tmpHome, '.lsp-cache', 'global', 'sources', 'g-a-v');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.lastaccess'), '9999', 'utf-8');

    const ts = await accessTracker.getMaxTimestamp('sources', 'g-a-v');
    expect(ts).toBe(9999);
  });
});
