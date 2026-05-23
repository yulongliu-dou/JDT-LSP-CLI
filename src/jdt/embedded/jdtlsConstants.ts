import * as os from 'os';
import * as path from 'path';

/** 用户级 JDT LS 存储根目录 */
export const JDTLS_STORAGE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.jdt-lsp-cli',
  'jdtls'
);

/** 构建时打包的 JDT LS tar.gz 存放目录（相对于项目根目录） */
export const JDTLS_PACKAGE_DIR_NAME = 'jdtls';

/** 默认锁定版本（构建时使用，如远程不可达） */
export const JDTLS_DEFAULT_VERSION = '1.58.0';

/** 从当前模块文件定位项目根目录 */
export function getProjectRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

/** 获取 npm 包内置 JDT LS 目录 */
export function getPackageJdtlsDir(): string {
  return path.join(getProjectRoot(), JDTLS_PACKAGE_DIR_NAME);
}
