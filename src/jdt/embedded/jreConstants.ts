import * as os from 'os';
import * as path from 'path';

export const JRE_STORAGE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.jdt-lsp-cli',
  'jre'
);

export const ADOPTIUM_API_BASE = 'https://api.adoptium.net';
export const JRE_TARGET_VERSION = 21;
export const NETWORK_PROBE_TIMEOUT_MS = 3000;
export const MIN_DISK_SPACE_MB = 200;

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
