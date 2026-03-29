/**
 * JDT LSP CLI 类型定义
 */

export interface Position {
  line: number;    // 1-based line number
  character: number; // 1-based column number
}

// ========== 符号定位查询类型 ==========

/**
 * 符号查询参数 - 用于通过符号名称定位位置
 */
export interface SymbolQuery {
  name: string;              // 符号名称 (必填)
  kind?: string;             // 符号类型: Method, Field, Class, Interface...
  container?: string;        // 父容器路径: "MyClass" 或 "MyClass.innerMethod"
  signature?: string;        // 方法签名: "(String, int)" 用于区分重载
  index?: number;            // 同名符号索引: 0, 1, 2... (备选方案)
}

/**
 * 符号解析结果
 */
export interface ResolvedPosition {
  line: number;              // 1-based 行号
  character: number;         // 1-based 列号
  confidence: 'exact' | 'partial' | 'ambiguous';  // 匹配置信度
  matchedSymbol: string;     // 完整匹配路径
  alternatives?: string[];   // 如有歧义，列出候选
}

/**
 * 符号解析错误
 */
export interface SymbolResolutionError {
  type: 'not_found' | 'ambiguous' | 'invalid_query';
  message: string;
  suggestions?: {
    availableSymbols?: string[];      // 文件中可用的符号列表
    similarNames?: string[];          // 相似名称建议
    overloadOptions?: string[];       // 重载方法的签名列表
  };
}

/**
 * 符号信息（从 documentSymbol 返回）
 */
export interface SymbolInfo {
  name: string;
  kind: string;
  detail?: string;
  range: Range;
  selectionRange: Range;
  children?: SymbolInfo[];
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

/**
 * 工作区符号（workspace/symbol 返回）
 */
export interface WorkspaceSymbol {
  name: string;
  kind: number | string;
  containerName?: string;
  location: Location;
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
  maxProjects: number;       // 最大同时活跃项目数（默认 1）
  perProjectMemory: string;  // 每项目内存限制（如 "1g"）
}

/**
 * 项目配置（可选，用于优先级等）
 */
export interface ProjectConfig {
  priority: number;          // 优先级（越高越不容易被淘汰，默认 0）
  jvmConfig?: Partial<JvmConfig>;  // 项目特定的 JVM 配置
}

/**
 * 完整配置文件结构
 */
export interface DaemonConfig {
  jvm: JvmConfig;
  daemon: DaemonConfigOptions;
  projects?: Record<string, ProjectConfig>;  // 项目路径 -> 配置
}

/**
 * 项目状态信息
 */
export interface ProjectStatus {
  /** 项目是否被重新加载（因 LRU 淘汰后重新访问） */
  reloaded?: boolean;
  /** 项目加载耗时（毫秒） */
  loadTime?: number;
  /** 被置换出去的项目路径 */
  evictedProject?: string;
}

/**
 * 响应元数据 - 提供关于响应本身的附加信息
 */
export interface ResponseMetadata {
  /** 是否为紧凑模式输出 */
  compactMode?: boolean;
  /** symbols 命令中 children 字段被省略 */
  childrenExcluded?: boolean;
  /** 总符号数量 */
  totalSymbols?: number;
  /** 调用链深度限制 */
  depthLimit?: number;
  /** 项目加载状态（多项目模式） */
  projectStatus?: ProjectStatus;
}

export interface CLIResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  elapsed?: number;
  /** 响应元数据，提供关于响应的附加信息 */
  metadata?: ResponseMetadata;
}

// ========== 紧凑输出配置 ==========

/**
 * 紧凑输出字段配置
 */
export interface CompactFieldConfig {
  definition: string[];
  references: string[];
  refs: string[];  // 别名
  symbols: string[];
  sym: string[];   // 别名
  callHierarchy: string[];
  hover: string[];
  implementations: string[];
  impl: string[];  // 别名
  typeDefinition: string[];
  typedef: string[];  // 别名
  workspaceSymbols: string[];
  find: string[];  // 别名
  f: string[];     // 别名
}

/**
 * 默认紧凑输出字段（每个命令只保留核心字段）
 */
export const COMPACT_FIELDS: CompactFieldConfig = {
  definition: ['uri', 'range.start.line', 'range.start.character'],
  references: ['uri', 'range.start.line'],
  refs: ['uri', 'range.start.line'],  // 别名支持
  symbols: ['name', 'kind', 'range.start.line'],
  sym: ['name', 'kind', 'range.start.line'],  // 别名支持
  callHierarchy: ['entry', 'calls', 'totalMethods'],
  hover: ['contents'],
  implementations: ['uri', 'range.start.line'],
  impl: ['uri', 'range.start.line'],  // 别名支持
  typeDefinition: ['uri', 'range.start.line'],
  typedef: ['uri', 'range.start.line'],  // 别名支持
  workspaceSymbols: ['name', 'kind', 'location.uri', 'location.range.start.line'],
  find: ['name', 'kind', 'location.uri', 'location.range.start.line'],  // 别名支持
  f: ['name', 'kind', 'location.uri', 'location.range.start.line'],  // 别名支持
};

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
