/**
 * Daemon 级全局配置持久化
 *
 * 读写 `~/.lsp-cache/daemon-config.json`。
 * - 读：若不存在或 JSON 非法，直接返回默认值（不抛错）
 * - 写：原子写（临时文件 + rename），避免并发截断
 *
 * 参见：[SP01 子计划 Task 1.9](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLspCacheRoot } from './platform/pathUtils';
import { DEFAULT_CONFIG, LibraryProviderConfig, mergeConfig } from './config';

const CONFIG_FILE_NAME = 'daemon-config.json';

function configPath(): string {
  return path.join(getLspCacheRoot(), CONFIG_FILE_NAME);
}

/**
 * 读取配置；缺失或损坏均返回默认值
 */
export function load(): LibraryProviderConfig {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) {
      // 首次调用：写入默认文件，便于用户直接编辑
      save(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LibraryProviderConfig>;
    return mergeConfig(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 保存配置（原子写）
 *
 * @param partial 可以为部分配置，会与当前磁盘内容合并
 */
export function save(partial: Partial<LibraryProviderConfig>): LibraryProviderConfig {
  const root = getLspCacheRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  // 与磁盘已有内容合并
  let current: LibraryProviderConfig;
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      current = mergeConfig(JSON.parse(raw));
    } else {
      current = { ...DEFAULT_CONFIG };
    }
  } catch {
    current = { ...DEFAULT_CONFIG };
  }
  const next = mergeConfig({ ...current, ...partial });
  const target = configPath();
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch {
    // Windows 下偶发重命名失败：退化为 copy + unlink
    fs.copyFileSync(tmp, target);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  return next;
}
