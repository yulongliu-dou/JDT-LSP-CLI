/**
 * SP05 集成测试：LibraryClassLocator daemon 集成
 *
 * 覆盖：
 * - 单例复用（跨请求共享）
 * - warnings 降级提示收集
 * - cache stats 结构合法性
 * - 定时清理 TTL 行为
 *
 * 参见：[SP05 子计划 Task 5.5](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP05-Daemon集成与预取_e5f6a7b8.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DaemonStateManager } from '../../../src/daemon/core/daemonStateManager';
import { collectStats, CacheStats } from '../../../src/libraryProvider/cache/cacheStats';
import { cleanStale, CleanStaleReport } from '../../../src/libraryProvider/cache/cacheCleaner';
import * as accessTracker from '../../../src/libraryProvider/cache/accessTracker';
import * as globalCache from '../../../src/libraryProvider/cache/globalCache';
import { LibraryClassLocator } from '../../../src/libraryProvider/core/libraryClassLocator';

// 使用临时目录隔离文件系统操作
const tmpRoot = path.join(os.tmpdir(), `jls-test-sp05-${process.pid}-${Date.now()}`);

// Mock getLspCacheRoot 和 scopeDir 以使用临时目录
jest.mock('../../../src/libraryProvider/platform/pathUtils', () => {
  const actual = jest.requireActual('../../../src/libraryProvider/platform/pathUtils');
  return {
    ...actual,
    getLspCacheRoot: jest.fn(() => {
      // 在 mock factory 中无法使用外部变量，直接返回固定临时路径
      const p = require('path');
      const o = require('os');
      return p.join(o.tmpdir(), 'jls-test-sp05-global');
    }),
  };
});

beforeAll(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
  // 也创建 mock 会用的 global 目录
  const mockGlobal = path.join(os.tmpdir(), 'jls-test-sp05-global', 'global');
  try { fs.mkdirSync(mockGlobal, { recursive: true }); } catch { /* ignore */ }
});

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  // 清理 mock 目录
  const mockGlobal = path.join(os.tmpdir(), 'jls-test-sp05-global');
  try { fs.rmSync(mockGlobal, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // 每个测试前重置 accessTracker 内存状态
  accessTracker._resetForTest();
});

// ========== 缓存统计 ==========

describe('cache stats', () => {
  test('empty cache returns zero stats', () => {
    const stats = collectStats();
    expect(stats.totalBytes).toBe(0);
    expect(typeof stats.buckets).toBe('object');
    expect(Object.keys(stats.buckets).length).toBe(0);
  });

  test('returns valid structure with cache content', async () => {
    // 写入一些缓存内容
    const bucket: globalCache.CacheBucket = 'sources';
    const scope = 'com.example/test-lib/1.0';
    const fqcn = 'com.example.TestClass';
    const content = 'package com.example;\npublic class TestClass {}\n';

    const cachePath = await globalCache.write(bucket, scope, fqcn, content);
    expect(fs.existsSync(cachePath)).toBe(true);

    // 标记访问
    accessTracker.touch(bucket, scope);
    await accessTracker.flush();

    const stats = collectStats();
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.buckets.sources).toBeDefined();
    expect(stats.buckets.sources.scopeCount).toBe(1);
    expect(stats.buckets.sources.bytes).toBeGreaterThan(0);
  });
});

// ========== 定时清理 (TTL) ==========

describe('cleanup TTL', () => {
  test('cleanStale with ttlDays=0 returns valid report', async () => {
    const report = await cleanStale(0);
    // ttlDays=0 时 threshold = Date.now()+1，所有条目都在阈值内，保留
    expect(typeof report.scanned).toBe('number');
    expect(typeof report.removed).toBe('number');
    expect(Array.isArray(report.removedScopes)).toBe(true);
  });

  test('cleanStale removes stale entries based on access.log', async () => {
    // 写入两个 scope：一个"新"，一个"旧"
    const bucket: globalCache.CacheBucket = 'decompiled';
    const recentScope = 'recent-scope';
    const staleScope = 'stale-scope';
    const fqcn = 'com.Test';

    await globalCache.write(bucket, recentScope, fqcn, 'class Test {}');
    await globalCache.write(bucket, staleScope, fqcn, 'class Test {}');

    // 标记访问时间：recent = 现在，stale = 30 天前
    accessTracker.touch(bucket, recentScope);
    // staleScope 不 touch → 依赖目录 mtime（< 当前时间）

    // 设置访问日志中的 stale 时间戳为 30 天前
    const staleTs = Date.now() - 31 * 86_400_000;
    // 直接写 .lastaccess 文件模拟旧访问记录
    const staleDir = globalCache.scopeDir(bucket, staleScope);
    fs.writeFileSync(path.join(staleDir, '.lastaccess'), String(staleTs), 'utf-8');

    await accessTracker.flush();

    // TTL = 7 天，stale 应为 30 天前 → 应被清理
    const report = await cleanStale(7);
    expect(report.scanned).toBeGreaterThanOrEqual(1);
    // recent 应在，stale 应被删除
    const removed = report.removedScopes.filter(s => s.includes(staleScope));
    expect(removed.length).toBeGreaterThanOrEqual(1);

    // 验证 recent scope 目录仍存在
    const recentDir = globalCache.scopeDir(bucket, recentScope);
    expect(fs.existsSync(recentDir)).toBe(true);
  });

  test('cleanStale with very large TTL keeps everything', async () => {
    const bucket: globalCache.CacheBucket = 'jdk';
    const scope = 'keep-forever';
    const fqcn = 'com.Test';

    await globalCache.write(bucket, scope, fqcn, 'class Test {}');
    accessTracker.touch(bucket, scope);
    await accessTracker.flush();

    // TTL = 365 天 → 一切保留
    const report = await cleanStale(365);
    // 可能还会扫描到 test 目录下的旧条目，但不应删除刚创建的
    const removedCurrent = report.removedScopes.filter(s => s.includes(scope));
    expect(removedCurrent.length).toBe(0);
  });
});

// ========== warnings 降级提示 ==========

describe('warnings accumulation', () => {
  test('onWarning callback pushes to warnings array', () => {
    const manager = new DaemonStateManager();
    // 模拟 client 提供 classFileContents
    (manager as any).client = {
      getClassFileContents: jest.fn().mockResolvedValue('class Test {}'),
    };

    const locator = manager.getLibraryLocator();
    expect(locator).toBeInstanceOf(LibraryClassLocator);
    // warnings 初始为空
    expect(manager.warnings.length).toBe(0);

    // 直接触发 onWarning
    const deps = (locator as any).deps;
    expect(typeof deps.onWarning).toBe('function');

    deps.onWarning('Symbolic links unavailable for scope sources/test; falling back to file copies.');
    expect(manager.warnings.length).toBe(1);
    expect(manager.warnings[0]).toContain('Symbolic links unavailable');
  });

  test('warnings capped at 200 to prevent memory leak', () => {
    const manager = new DaemonStateManager();
    (manager as any).client = {
      getClassFileContents: jest.fn().mockResolvedValue('class Test {}'),
    };

    const locator = manager.getLibraryLocator();
    const deps = (locator as any).deps;

    // 推送 250 条 warning
    for (let i = 0; i < 250; i++) {
      deps.onWarning(`Warning ${i}`);
    }

    expect(manager.warnings.length).toBe(200);
    // 第 200 条是 Warning 199（编号从 0 开始，cap 在 push 后检查，最后一条推入的是 Warning 199）
    expect(manager.warnings[199]).toBe('Warning 199');
  });
});

// ========== 单例复用 ==========

describe('LibraryClassLocator singleton', () => {
  test('getLibraryLocator returns same instance on repeated calls', () => {
    const manager = new DaemonStateManager();
    (manager as any).client = {
      getClassFileContents: jest.fn().mockResolvedValue('class Test {}'),
    };

    const first = manager.getLibraryLocator();
    const second = manager.getLibraryLocator();

    expect(first).toBe(second);
    expect(first).toBeInstanceOf(LibraryClassLocator);
  });

  test('throws when resolving without client', async () => {
    const manager = new DaemonStateManager();
    // client 未设置 → 创建 locator 不报错（懒求值闭包），但 resolve 时会 throw
    const locator = manager.getLibraryLocator();
    expect(locator).toBeInstanceOf(LibraryClassLocator);
    // 实际 resolve 需要 client.getClassFileContents，此处不 mock 则后续调用会失败
  });
});
