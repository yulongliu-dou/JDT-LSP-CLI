/**
 * JVM 配置加载器
 */

import * as os from 'os';
import * as path from 'path';
import { readJsonFile, writeJsonFile, ensureDir } from '../core/utils/fileUtils';
import { log } from '../core/logger';
import { JvmConfig, DaemonConfig, DaemonConfigOptions } from '../core/types';
import {
  DEFAULT_JVM_XMS,
  DEFAULT_JVM_XMX,
  DEFAULT_GC_PAUSE_MS,
  DEFAULT_SOFT_REF_LRU_MS_PER_MB,
  DEFAULT_G1_PERIODIC_GC_INTERVAL_MS,
  DEFAULT_MAX_HEAP_FREE_RATIO,
  DEFAULT_MIN_HEAP_FREE_RATIO,
  DEFAULT_MAX_METASPACE_SIZE,
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
} from '../core/constants';

// 配置文件路径
export const CONFIG_DIR = path.join(os.homedir(), CONFIG_DIR_NAME);
export const CONFIG_FILE = path.join(CONFIG_DIR, CONFIG_FILE_NAME);

/**
 * 默认 JVM 配置（低内存占用 + 稳定性优化）
 */
export const DEFAULT_JVM_CONFIG: JvmConfig = {
  xms: DEFAULT_JVM_XMS,
  xmx: DEFAULT_JVM_XMX,
  useG1GC: true,
  maxGCPauseMillis: DEFAULT_GC_PAUSE_MS,
  useStringDeduplication: true,
  softRefLRUPolicyMSPerMB: DEFAULT_SOFT_REF_LRU_MS_PER_MB,
  g1PeriodicGCIntervalMs: DEFAULT_G1_PERIODIC_GC_INTERVAL_MS,
  maxHeapFreeRatio: DEFAULT_MAX_HEAP_FREE_RATIO,
  minHeapFreeRatio: DEFAULT_MIN_HEAP_FREE_RATIO,
  maxMetaspaceSize: DEFAULT_MAX_METASPACE_SIZE,
  extraArgs: [],
};

/**
 * 默认守护进程配置
 */
export const DEFAULT_DAEMON_CONFIG: DaemonConfigOptions = {
  port: 9876,
  idleTimeoutMinutes: 30,
  maxProjects: 3,           // 默认最多 3 个项目
  perProjectMemory: '1g',   // 每项目 1GB
  autoScaling: {
    enabled: true,
    minProjects: 1,
    maxProjects: 3,
    scaleCooldownSeconds: 30,
    checkIntervalSeconds: 15,
    idleEvictMinutes: 30,
    maxSnapshotAgeMs: 60000,
    drainTimeoutMs: 5000,
    collectionTimeoutMs: 10000,
  },
};

/**
 * 加载用户配置文件
 */
export function loadConfig(): DaemonConfig {
  const defaultConfig: DaemonConfig = {
    jvm: { ...DEFAULT_JVM_CONFIG },
    daemon: { ...DEFAULT_DAEMON_CONFIG },
  };

  if (!CONFIG_FILE) {
    return defaultConfig;
  }

  try {
    const userConfig = readJsonFile<Partial<DaemonConfig>>(CONFIG_FILE);
    if (!userConfig) {
      return defaultConfig;
    }

    // 合并配置
    const merged: DaemonConfig = {
      jvm: { ...DEFAULT_JVM_CONFIG, ...(userConfig.jvm || {}) },
      daemon: { ...DEFAULT_DAEMON_CONFIG, ...(userConfig.daemon || {}) },
    };

    // 如果用户定义了项目特定配置，保留
    if (userConfig.projects) {
      merged.projects = userConfig.projects;
    }

    return merged;
  } catch (error: any) {
    log('Failed to load config:', error.message);
    return defaultConfig;
  }
}

/**
 * 保存配置到文件
 */
export function saveConfig(config: DaemonConfig): void {
  try {
    ensureDir(CONFIG_DIR);
    writeJsonFile(CONFIG_FILE, config);
    log('Config saved to:', CONFIG_FILE);
  } catch (error: any) {
    log('Failed to save config:', error.message);
    throw error;
  }
}

/**
 * 生成默认配置模板
 */
export function generateConfigTemplate(): string {
  const config: DaemonConfig = {
    jvm: DEFAULT_JVM_CONFIG,
    daemon: DEFAULT_DAEMON_CONFIG,
  };

  ensureDir(CONFIG_DIR);
  writeJsonFile(CONFIG_FILE, config);
  
  return CONFIG_FILE;
}
