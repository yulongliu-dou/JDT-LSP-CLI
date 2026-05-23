import * as os from 'os';
import * as path from 'path';

export const JRE_STORAGE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.jdt-lsp-cli',
  'jre'
);

export const ADOPTIUM_API_BASE = 'https://api.adoptium.net';
export const ADOPTIUM_API_ASSETS_URL = `${ADOPTIUM_API_BASE}/v3/assets/latest/21/hotspot`;
export const GITHUB_API_RELEASES_URL = 'https://api.github.com/repos/adoptium/temurin21-binaries/releases/latest';
export const USTC_MIRROR_BASE = 'https://mirrors.ustc.edu.cn/adoptium';
export const TUNA_MIRROR_BASE = 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium';
export const JRE_TARGET_VERSION = 21;
export const PROBE_TIMEOUT_MS = 8000;
export const ADOPTIUM_PROBE_TIMEOUT_MS = 5000;
export const DOWNLOAD_RETRY_MAX = 3;
export const DOWNLOAD_RETRY_BASE_MS = 1000;

/** 平台 → Adoptium API 参数映射 */
export function getAdoptiumPlatform(): { os: string; arch: string; ext: string } {
  const platform = os.platform();
  const archName = os.arch();

  const osMap: Record<string, string> = {
    win32: 'windows',
    darwin: 'mac',
    linux: 'linux',
  };

  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'aarch64',
  };

  const extMap: Record<string, string> = {
    windows: 'zip',
    mac: 'tar.gz',
    linux: 'tar.gz',
  };

  const mappedOs = osMap[platform] || 'linux';
  return {
    os: mappedOs,
    arch: archMap[archName] || 'x64',
    ext: extMap[mappedOs] || 'tar.gz',
  };
}
