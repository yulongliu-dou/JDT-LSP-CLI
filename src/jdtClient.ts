/**
 * JDT LSP CLI - JDT Language Server Client
 * 
 * 向后兼容的导出模块
 * 实际实现在 jdt/ 目录的模块化版本中
 */

// 重新导出 JdtLsClient（模块化实现）
export { JdtLsClient } from './jdt/client';

// 重新导出配置相关
export { 
  CONFIG_DIR, 
  CONFIG_FILE, 
  DEFAULT_JVM_CONFIG,
  loadConfig,
  generateConfigTemplate 
} from './jdt/configLoader';
