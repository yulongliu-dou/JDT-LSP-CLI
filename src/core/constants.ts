/**
 * 核心常量定义
 */

// 守护进程默认配置
export const DEFAULT_DAEMON_PORT = 9876;

// 配置文件路径
export const CONFIG_DIR_NAME = '.jdt-lsp-cli';
export const CONFIG_FILE_NAME = 'config.json';
export const PID_FILE_NAME = 'daemon.pid';
export const LOG_FILE_NAME = 'daemon.log';

// 超时配置
export const DEFAULT_TIMEOUT_MS = 60000;
export const DAEMON_REQUEST_TIMEOUT_MS = 120000;
export const INIT_TIMEOUT_MS = 120000;

// JVM 默认配置
export const DEFAULT_JVM_XMS = '256m';
export const DEFAULT_JVM_XMX = '2g';
export const DEFAULT_GC_PAUSE_MS = 200;
export const DEFAULT_SOFT_REF_LRU_MS_PER_MB = 50;

// LSP 相关常量
export const LSP_INITIALIZE_TIMEOUT = 300000; // 5 分钟
export const LSP_SHUTDOWN_TIMEOUT = 10000;    // 10 秒

// 符号解析常量
export const SYMBOL_RESOLUTION_CONFIDENCE = {
  EXACT: 'exact',
  PARTIAL: 'partial',
  AMBIGUOUS: 'ambiguous',
} as const;

// 项目加载状态
export const PROJECT_STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
  NOT_LOADED: 'not_loaded',
} as const;

// 初始化阶段
export const INIT_STAGE = {
  IDLE: 'idle',
  STARTING: 'starting',
  JDT_LAUNCHING: 'jdt-launching',
  INITIALIZING: 'initializing',
  INDEXING: 'indexing',
  READY: 'ready',
  ERROR: 'error',
} as const;
