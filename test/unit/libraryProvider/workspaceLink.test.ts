/**
 * workspaceLink 单元测试（SP02 Task 2.10）
 *
 * 覆盖：
 * - linkScope 成功路径（symlink/junction/copy 之一，取决于平台）
 * - symlink 抛 EPERM → 降级为拷贝
 * - ensureGitignore 幂等追加
 *
 * 参见 SP02 Task 2.2
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 允许测试在 workspaceLink 内部注入 symlinkSync，用于覆盖 EPERM 降级分支。
// fs.symlinkSync 在部分 Node 版本上为只 getter 属性，无法直接 spy，故通过 jest.mock 重写。
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    symlinkSync: (target: fs.PathLike, linkPath: fs.PathLike, type?: fs.symlink.Type) => {
      const mock = (global as any).__LP_SYMLINK_MOCK__;
      if (typeof mock === 'function') return mock(target, linkPath, type);
      return actual.symlinkSync(target, linkPath, type);
    },
  };
});

import * as workspaceLink from '../../../src/libraryProvider/cache/workspaceLink';

describe('workspaceLink', () => {
  let tmpHome: string;
  let tmpWs: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-wl-home-'));
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-wl-ws-'));
    (global as any).__LP_SYMLINK_MOCK__ = undefined;
  });

  afterEach(() => {
    (global as any).__LP_SYMLINK_MOCK__ = undefined;
    jest.restoreAllMocks();
    for (const p of [tmpHome, tmpWs]) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test('linkScope creates a reachable entry pointing to global dir', async () => {
    const globalDir = path.join(tmpHome, 'global-src', 'g-a-v');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'Probe.java'), 'class Probe {}', 'utf-8');

    const result = await workspaceLink.linkScope(tmpWs, 'sources/g-a-v', globalDir);
    expect(['symlink', 'junction', 'copy']).toContain(result.mode);
    expect(fs.existsSync(result.linkPath)).toBe(true);
    // 链接后可读到文件（symlink/junction 透明访问；copy 已复制）
    const content = fs.readFileSync(path.join(result.linkPath, 'Probe.java'), 'utf-8');
    expect(content).toBe('class Probe {}');
  });

  test('symlink EPERM falls back to copy', async () => {
    const globalDir = path.join(tmpHome, 'global-src', 'perm-fail');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'A.java'), 'A', 'utf-8');

    const symErr: NodeJS.ErrnoException = new Error('forbidden') as any;
    symErr.code = 'EPERM';
    (global as any).__LP_SYMLINK_MOCK__ = () => { throw symErr; };

    try {
      const result = await workspaceLink.linkScope(tmpWs, 'sources/perm-fail', globalDir);
      expect(result.mode).toBe('copy');
      expect(result.downgradeReason).toBe('EPERM');
      expect(fs.existsSync(path.join(result.linkPath, 'A.java'))).toBe(true);
    } finally {
      (global as any).__LP_SYMLINK_MOCK__ = undefined;
    }
  });

  test('ensureGitignore is idempotent', () => {
    const gi = path.join(tmpWs, '.gitignore');
    workspaceLink.ensureGitignore(tmpWs);
    expect(fs.existsSync(gi)).toBe(true);
    const first = fs.readFileSync(gi, 'utf-8');
    expect(first).toMatch(/\/\.lsp-cache\//);

    // 再调用一次不会重复追加
    workspaceLink.ensureGitignore(tmpWs);
    const second = fs.readFileSync(gi, 'utf-8');
    expect(second).toBe(first);
  });

  test('ensureGitignore preserves existing content and appends once', () => {
    const gi = path.join(tmpWs, '.gitignore');
    fs.writeFileSync(gi, 'node_modules/\ndist/\n', 'utf-8');
    workspaceLink.ensureGitignore(tmpWs);
    const updated = fs.readFileSync(gi, 'utf-8');
    expect(updated.startsWith('node_modules/\ndist/\n')).toBe(true);
    expect(updated).toMatch(/\/\.lsp-cache\//);
  });
});
