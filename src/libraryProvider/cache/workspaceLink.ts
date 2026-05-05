/**
 * 项目内缓存可见性（`<workspace>/.lsp-cache/jars/<scope>`）
 *
 * 为每个 scope 在项目内建立 symlink / junction 指向全局主本。
 * 若平台不支持（EPERM/EACCES/ENOSYS）→ 降级为 `fs.cp` 拷贝。
 *
 * 额外职责：追加 `/.lsp-cache/` 到 `.gitignore`（幂等）。
 *
 * 参见：[SP02 子计划 Task 2.2](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-%E7%BC%93%E5%AD%98%E4%B8%8EURI%E9%87%8D%E5%86%99_b2c3d4e5.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPlatformCaps } from '../platform/capsDetector';

export type LinkMode = 'symlink' | 'junction' | 'copy';

export interface LinkResult {
  /** 本次建立的链接绝对路径 `<workspace>/.lsp-cache/jars/<scope>` */
  linkPath: string;
  /** 采用的落地方式 */
  mode: LinkMode;
  /** 若发生了从 symlink/junction 降级为 copy，将给出降级原因 */
  downgradeReason?: string;
}

/** 降级回调；由 SP05 接入 DaemonStateManager.warnings */
export type DowngradeCallback = (scope: string, reason: string) => void;
let downgradeCallback: DowngradeCallback | null = null;
export function setDowngradeCallback(cb: DowngradeCallback | null): void {
  downgradeCallback = cb;
}

/** `<workspace>/.lsp-cache/jars` */
function jarsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.lsp-cache', 'jars');
}

/** 清理已有目标（用于重建），不存在时静默 */
function removeIfExists(p: string): void {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || st.isFile()) {
      fs.unlinkSync(p);
    } else if (st.isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {
    // 不存在
  }
}

function copyDirFallback(srcDir: string, destDir: string): void {
  // Node >= 16.7 提供 fs.cpSync，项目 jest.config.js / engines 已锁定 ≥18
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  (fs as unknown as { cpSync: (s: string, d: string, o: any) => void }).cpSync(
    srcDir,
    destDir,
    { recursive: true, force: true }
  );
}

/**
 * 为 `scope` 在 workspace 内建立可见性。
 *
 * @param workspaceRoot   工作区根目录（绝对路径）
 * @param scope           bucket/scope 的唯一键；调用方保证路径安全（不含 `..`）
 * @param globalScopeDir  全局主本 `<bucket>/<scope>` 的绝对目录
 */
export async function linkScope(
  workspaceRoot: string,
  scope: string,
  globalScopeDir: string
): Promise<LinkResult> {
  const linkRoot = jarsDir(workspaceRoot);
  fs.mkdirSync(linkRoot, { recursive: true });

  // scope 可能含 `/`（如 `jdk/21/java.base`），允许创建多级父目录
  const linkPath = path.join(linkRoot, scope);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  // 已存在且是链接/目录则复用（以链接类型判定）
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      const current = fs.readlinkSync(linkPath);
      if (path.resolve(current) === path.resolve(globalScopeDir)) {
        const mode: LinkMode = os.platform() === 'win32' ? 'junction' : 'symlink';
        return { linkPath, mode };
      }
      // 指向错误 → 重建
      removeIfExists(linkPath);
    } else if (st.isDirectory()) {
      // 之前可能是拷贝：直接复用（不强制重建，避免影响 IDE）
      return { linkPath, mode: 'copy' };
    }
  } catch {
    // 不存在
  }

  const caps = getPlatformCaps();
  const platform = os.platform();

  // 优先尝试 symlink / junction
  if (platform === 'win32') {
    if (caps.supportsJunction) {
      try {
        fs.symlinkSync(globalScopeDir, linkPath, 'junction');
        return { linkPath, mode: 'junction' };
      } catch (err: any) {
        return fallbackToCopy(scope, globalScopeDir, linkPath, err?.code || 'UNKNOWN');
      }
    }
    // 平台探测声明不支持 → 直接拷贝
    return fallbackToCopy(scope, globalScopeDir, linkPath, 'no-junction');
  }

  if (caps.supportsSymlink) {
    try {
      fs.symlinkSync(globalScopeDir, linkPath, 'dir');
      return { linkPath, mode: 'symlink' };
    } catch (err: any) {
      return fallbackToCopy(scope, globalScopeDir, linkPath, err?.code || 'UNKNOWN');
    }
  }
  return fallbackToCopy(scope, globalScopeDir, linkPath, 'no-symlink');
}

function fallbackToCopy(
  scope: string,
  globalScopeDir: string,
  linkPath: string,
  reason: string
): LinkResult {
  try {
    copyDirFallback(globalScopeDir, linkPath);
  } catch (copyErr: any) {
    // 拷贝也失败：保留空目录占位，避免调用方层层抛错
    fs.mkdirSync(linkPath, { recursive: true });
  }
  if (downgradeCallback) {
    try { downgradeCallback(scope, reason); } catch { /* ignore */ }
  }
  return { linkPath, mode: 'copy', downgradeReason: reason };
}

/**
 * 幂等地把 `/.lsp-cache/` 追加到 `.gitignore`。
 *
 * - 文件不存在 → 直接创建
 * - 已存在但未包含 → 末尾追加（保留原 EOL 风格）
 * - 已存在且包含 → no-op
 */
export function ensureGitignore(workspaceRoot: string): void {
  const giPath = path.join(workspaceRoot, '.gitignore');
  const entry = '/.lsp-cache/';
  let content = '';
  if (fs.existsSync(giPath)) {
    try {
      content = fs.readFileSync(giPath, 'utf-8');
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/).map((l) => l.trim());
    if (lines.includes(entry) || lines.includes(entry.replace(/\/$/, ''))) {
      return;
    }
  }
  try {
    const eol = content.includes('\r\n') ? '\r\n' : (content.length === 0 ? os.EOL : '\n');
    const needLeadingEol = content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r\n');
    const appendText = (needLeadingEol ? eol : '') + entry + eol;
    fs.appendFileSync(giPath, appendText, 'utf-8');
  } catch {
    // .gitignore 写失败不是关键路径
  }
}
