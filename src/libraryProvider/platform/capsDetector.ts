/**
 * 平台能力探测
 *
 * 首次调用时检测当前平台是否支持：
 * - symlink（Windows 可能需要管理员/开发者模式）
 * - junction（Windows 独有）
 * 结果缓存到 `~/.lsp-cache/platform-caps.json`，避免每次探测。
 *
 * 参见：[SP01 子计划 Task 1.10](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLspCacheRoot } from './pathUtils';

export interface PlatformCaps {
  /** 是否支持 symlink */
  supportsSymlink: boolean;
  /** 是否支持 junction（Windows 特性） */
  supportsJunction: boolean;
  /** 检测时间戳（ms） */
  detectedAt: number;
  /** 运行平台（冗余字段，切换平台后会重新探测） */
  platform: NodeJS.Platform;
}

const CAPS_FILE = 'platform-caps.json';
/** 缓存有效期：7 天 */
const CAPS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let memoCache: PlatformCaps | null = null;

function capsPath(): string {
  return path.join(getLspCacheRoot(), CAPS_FILE);
}

function loadCapsFromDisk(): PlatformCaps | null {
  try {
    const p = capsPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as PlatformCaps;
    if (!parsed || typeof parsed.detectedAt !== 'number') return null;
    if (parsed.platform !== os.platform()) return null;
    if (Date.now() - parsed.detectedAt > CAPS_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCapsToDisk(caps: PlatformCaps): void {
  try {
    const root = getLspCacheRoot();
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    const tmp = capsPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(caps, null, 2), 'utf-8');
    fs.renameSync(tmp, capsPath());
  } catch {
    // 忽略磁盘写入错误：能力探测不是关键路径
  }
}

/**
 * 实际探测：在临时目录尝试创建 symlink / junction
 */
function probe(): PlatformCaps {
  const platform = os.platform();
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-caps-'));
  const targetDir = path.join(tmpBase, 'target');
  fs.mkdirSync(targetDir);

  let supportsSymlink = false;
  let supportsJunction = false;

  // 探测 symlink
  try {
    const symlinkPath = path.join(tmpBase, 'lnk');
    fs.symlinkSync(targetDir, symlinkPath, 'dir');
    supportsSymlink = fs.lstatSync(symlinkPath).isSymbolicLink();
  } catch {
    supportsSymlink = false;
  }

  // 探测 junction（仅 Windows 有意义）
  if (platform === 'win32') {
    try {
      const junctionPath = path.join(tmpBase, 'jct');
      fs.symlinkSync(targetDir, junctionPath, 'junction');
      supportsJunction = fs.existsSync(junctionPath);
    } catch {
      supportsJunction = false;
    }
  }

  // 清理
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    // ignore
  }

  return {
    supportsSymlink,
    supportsJunction,
    detectedAt: Date.now(),
    platform,
  };
}

/**
 * 获取平台能力（缓存 + 懒探测）
 */
export function getPlatformCaps(): PlatformCaps {
  if (memoCache) return memoCache;
  const cached = loadCapsFromDisk();
  if (cached) {
    memoCache = cached;
    return cached;
  }
  const detected = probe();
  saveCapsToDisk(detected);
  memoCache = detected;
  return detected;
}

/**
 * 强制重新探测（主要用于测试/CLI 诊断）
 */
export function refreshPlatformCaps(): PlatformCaps {
  memoCache = null;
  const detected = probe();
  saveCapsToDisk(detected);
  memoCache = detected;
  return detected;
}
