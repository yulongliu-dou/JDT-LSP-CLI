/**
 * globalCache 单元测试（SP02 Task 2.10）
 *
 * 覆盖：
 * - lookup / write / fileFor 基础语义
 * - withLock 并发串行化（第二个等待第一个释放，waitMs > 0）
 * - markFailed / isFailed / clearFailed
 *
 * 参见 SP02 Task 2.1
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

import * as globalCache from '../../../src/libraryProvider/cache/globalCache';

describe('globalCache', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-gc-'));
    (global as any).__LP_TEST_HOME__ = tmpHome;
  });

  afterEach(() => {
    (global as any).__LP_TEST_HOME__ = undefined;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('fileFor: builds `<root>/global/<bucket>/<scope>/<pkg>/<Class>.java`', () => {
    const p = globalCache.fileFor('jdk', '21/java.base', 'java.util.List');
    expect(p).toBe(
      path.join(tmpHome, '.lsp-cache', 'global', 'jdk', '21', 'java.base', 'java', 'util', 'List.java')
    );
  });

  test('lookup returns null when missing', () => {
    expect(globalCache.lookup('sources', 'g-a-v', 'com.foo.Bar')).toBeNull();
  });

  test('write then lookup hits', async () => {
    const p = await globalCache.write('sources', 'g-a-v', 'com.foo.Bar', 'class Bar {}');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('class Bar {}');
    expect(globalCache.lookup('sources', 'g-a-v', 'com.foo.Bar')).toBe(p);
  });

  test('withLock serializes concurrent access for same scope', async () => {
    const order: string[] = [];
    const task = (label: string, ms: number) => async () => {
      order.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${label}:end`);
      return label;
    };

    const pA = globalCache.withLock('sources', 'concurrent-scope', task('A', 120));
    // 稍晚启动 B，确保 A 已拿到锁
    await new Promise((r) => setTimeout(r, 20));
    const pB = globalCache.withLock('sources', 'concurrent-scope', task('B', 20));

    const [a, b] = await Promise.all([pA, pB]);
    expect(a.result).toBe('A');
    expect(b.result).toBe('B');
    // A 必须先结束再 B 才能开始
    const aEndIdx = order.indexOf('A:end');
    const bStartIdx = order.indexOf('B:start');
    expect(aEndIdx).toBeLessThan(bStartIdx);
    // B 经历了等待
    expect(b.waitMs).toBeGreaterThan(0);
  });

  test('withLock different scopes run in parallel', async () => {
    const trace: string[] = [];
    const make = (label: string) => async () => {
      trace.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, 80));
      trace.push(`${label}:end`);
      return label;
    };
    const pA = globalCache.withLock('sources', 'scope-a', make('A'));
    const pB = globalCache.withLock('sources', 'scope-b', make('B'));
    await Promise.all([pA, pB]);
    // 并行时两个 start 应该都在任一 end 之前
    const aStart = trace.indexOf('A:start');
    const bStart = trace.indexOf('B:start');
    const aEnd = trace.indexOf('A:end');
    expect(bStart).toBeLessThan(aEnd);
    expect(aStart).toBeLessThan(trace.indexOf('B:end'));
  });

  test('markFailed / isFailed / clearFailed round-trip', () => {
    const bucket = 'decompiled' as const;
    const scope = 'failing-scope';
    expect(globalCache.isFailed(bucket, scope)).toBe(false);
    globalCache.markFailed(bucket, scope, 'vineflower crashed');
    expect(globalCache.isFailed(bucket, scope)).toBe(true);
    const failedPath = path.join(globalCache.scopeDir(bucket, scope), '.failed');
    const raw = JSON.parse(fs.readFileSync(failedPath, 'utf-8'));
    expect(raw.reason).toBe('vineflower crashed');
    expect(typeof raw.ts).toBe('number');
    globalCache.clearFailed(bucket, scope);
    expect(globalCache.isFailed(bucket, scope)).toBe(false);
  });

  test('withLock appends a line to lock-wait.log on wait > 0', async () => {
    const first = globalCache.withLock('jdk', 'log-scope', async () => {
      await new Promise((r) => setTimeout(r, 100));
      return 1;
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await globalCache.withLock('jdk', 'log-scope', async () => 2);
    await first;
    expect(second.waitMs).toBeGreaterThan(0);
    const logPath = path.join(tmpHome, '.lsp-cache', 'global', 'lock-wait.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).toMatch(/\|log-scope\|/);
  });
});
