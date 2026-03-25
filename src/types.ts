/**
 * JDT LSP CLI 类型定义
 */

export interface Position {
  line: number;    // 1-based line number
  character: number; // 1-based column number
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface CallHierarchyItem {
  name: string;
  kind: string;
  detail?: string;
  uri: string;
  range: Range;
  selectionRange: Range;
}

export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Range[];
}

export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem;
  fromRanges: Range[];
}

export interface DocumentSymbol {
  name: string;
  kind: string;
  detail?: string;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface CLIOptions {
  jdtlsPath?: string;       // Path to eclipse.jdt.ls
  projectPath: string;      // Java project root
  dataDir?: string;         // jdt.ls data directory
  timeout?: number;         // Operation timeout in ms
  verbose?: boolean;        // Verbose logging
}

/**
 * JVM 配置
 */
export interface JvmConfig {
  xms: string;                      // 初始堆大小，如 '256m'
  xmx: string;                      // 最大堆大小，如 '2g'
  useG1GC: boolean;                 // 使用 G1 垃圾收集器
  maxGCPauseMillis: number;         // 最大 GC 暂停时间（毫秒）
  useStringDeduplication: boolean;  // 启用字符串去重
  softRefLRUPolicyMSPerMB: number;  // 软引用清理策略
  extraArgs: string[];              // 额外的 JVM 参数
}

/**
 * 守护进程配置
 */
export interface DaemonConfigOptions {
  port: number;              // HTTP 服务端口
  idleTimeoutMinutes: number; // 空闲超时（分钟），0 表示不超时
}

/**
 * 完整配置文件结构
 */
export interface DaemonConfig {
  jvm: JvmConfig;
  daemon: DaemonConfigOptions;
}

export interface CLIResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  elapsed?: number;
}

// Symbol kinds mapping
export const SymbolKindMap: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter'
};
