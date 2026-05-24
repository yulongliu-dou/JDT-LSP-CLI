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
  kind?: string;             // 符号类型：Method, Field, Class, Interface...
  container?: string;        // 父容器路径："MyClass" 或 "MyClass.innerMethod"
  signature?: string;        // 方法签名："(String, int)" 用于区分重载
  index?: number;            // 同名符号索引：0, 1, 2... (备选方案)
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

// ========== 增强版调用链类型(AI友好) ==========

/**
 * 方法节点(增强版,用于AI分析)
 */
export interface MethodNode {
  id: string;                    // 唯一标识符(如 "m1", "m1_2")
  name: string;                  // 方法名
  kind: string;                  // 方法类型(Method/Constructor等)
  detail?: string;               // 方法详细信息
  uri: string;                   // 文件URI
  range: Range;                  // LSP Range(0-based)
  classPath: string;             // 类全路径(如 org.apache.ibatis.executor.SimpleExecutor)
  depth: number;                 // 调用深度层级(0=入口方法)
  startLine: number;             // 方法开始行号(1-based,方便AI使用)
  endLine: number;               // 方法结束行号(1-based)
  filePath?: string;             // 文件系统路径(从uri转换)
  children?: string[];           // 子方法ID列表
  callerId?: string;             // 调用者ID(用于构建调用关系)
}

/**
 * 游标状态(用于lazy模式)
 */
export interface CallHierarchyCursor {
  id: string;                    // 游标ID(如 "ch_cursor_abc123")
  entry: MethodNode;             // 入口方法
  visited: Map<string, MethodNode>;  // 已访问的方法映射
  callGraph: Map<string, string[]>;  // 调用图(parentId -> [childIds])
  maxDepth: number;              // 最大深度
  direction: 'incoming' | 'outgoing';  // 调用方向
  createdAt: number;             // 创建时间戳
  expiresAt: number;             // 过期时间戳
}

/**
 * 调用链查询模式
 */
export type CallHierarchyMode = 'lazy' | 'snapshot' | 'summary';

/**
 * 调用链查询参数
 */
export interface CallHierarchyQuery {
  filePath: string;              // 文件路径
  line: number;                  // 方法所在行(1-based)
  col: number;                   // 方法所在列(1-based)
  mode: CallHierarchyMode;       // 查询模式
  depth?: number;                // 查询深度(默认3)
  direction?: 'incoming' | 'outgoing';  // 调用方向(默认outgoing)
  
  // lazy模式参数
  cursor?: string;               // 游标ID(继续之前的查询)
  fetchSource?: string[];        // 需要获取源码的方法ID列表
  expandDepth?: string[];        // 需要展开子调用的方法ID列表
  
  // snapshot模式参数
  snapshotPath?: string;         // 快照文件路径
  includeSourceInSnapshot?: boolean;  // 快照中是否包含源码
  
  // summary模式参数
  maxSummaryDepth?: number;      // 摘要最大深度(默认2)
}

/**
 * Lazy模式响应
 */
export interface LazyCallHierarchyResult {
  mode: 'lazy';
  cursor: string;                // 游标ID(用于后续请求)
  entry: MethodNode;             // 入口方法
  methods: MethodNode[];         // 当前层级方法列表
  nextActions: string[];         // 建议的下一步操作
  expiresInSeconds: number;      // 游标过期时间
  usageGuide: {                  // AI使用指南
    description: string;         // 模式说明
    howToUseCursor: string;      // 如何使用游标
    howToUseMethodIds: string;   // 如何使用法法ID
    nextActionsExplanation: string; // nextActions说明
    example: string;             // 使用示例
  };
}

/**
 * 快照模式响应
 */
export interface SnapshotCallHierarchyResult {
  mode: 'snapshot';
  snapshotPath: string;          // 快照文件路径
  indexPath: string;             // 索引文件路径(AI可读)
  sourceDirPath: string;         // 源码目录路径
  metadata: {
    entry: string;               // 入口方法全路径
    totalMethods: number;        // 总方法数
    maxDepth: number;            // 最大深度
    generatedAt: string;         // 生成时间
  };
  usageGuide: {                  // AI使用指南
    description: string;         // 快照说明
    fileStructure: string;       // 文件结构说明
    howToUse: string[];          // 使用步骤
    methodIdFormat: string;      // 方法ID格式说明
    example: string;             // 使用示例
  };
}

/**
 * 摘要模式响应
 */
export interface SummaryCallHierarchyResult {
  mode: 'summary';
  entry: MethodNode;             // 入口方法
  summary: {
    totalMethods: number;        // 总方法数
    totalClasses: number;        // 涉及的类数
    depthDistribution: Record<number, number>;  // 每层方法数
    hotspots: HotspotInfo[];     // 热点方法
    externalDependencies: string[];  // 外部依赖
  };
  recommendations: RecommendationInfo[];  // AI分析建议
  callGraphSummary: string;      // 调用链文本摘要
  usageGuide: {                  // AI使用指南
    description: string;         // 模式说明
    howToUseSummary: string;     // 如何使用摘要
    whenToUseOtherModes: string; // 何时使用其他模式
    example: string;             // 使用示例
  };
}

/**
 * 热点方法信息
 */
export interface HotspotInfo {
  methodId: string;
  name: string;
  classPath: string;
  reason: string;                // 为什么是热点(如"被3个方法调用")
  callCount: number;             // 被调用次数
}

/**
 * 推荐信息
 */
export interface RecommendationInfo {
  action: string;                // 建议动作(如"查看","深入分析")
  methodId: string;
  methodName: string;
  reason: string;                // 推荐理由
  priority: 'high' | 'medium' | 'low';  // 优先级
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
  g1PeriodicGCIntervalMs: number;   // G1 空闲周期 GC 间隔（毫秒），0=禁用
  maxHeapFreeRatio: number;         // GC 后空闲堆超过此比例则收缩归还 OS
  minHeapFreeRatio: number;         // GC 后空闲堆低于此比例则扩容
  maxMetaspaceSize: string;         // 元数据区上限，如 '256m'
  extraArgs: string[];              // 额外的 JVM 参数
}

/**
 * 守护进程配置
 */
export interface DaemonConfigOptions {
  port: number;              // HTTP 服务端口
  idleTimeoutMinutes: number; // 空闲超时（分钟），0 表示不超时
  maxProjects: number;       // 最大同时活跃项目数（默认 3）
  perProjectMemory: string;  // 每项目内存限制（如 "1g"）
  autoScaling?: AutoScalingConfig; // 自动伸缩配置
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

// ========== 守护进程初始化进度 ==========

/**
 * 初始化阶段
 */
export type InitStage = 'idle' | 'starting' | 'jdt-launching' | 'initializing' | 'indexing' | 'ready' | 'error';

/**
 * 初始化进度信息
 */
export interface InitProgress {
  /** 当前阶段 */
  stage: InitStage;
  /** 进度百分比 0-100 */
  percent: number;
  /** 状态消息 */
  message: string;
  /** 已耗时（毫秒） */
  elapsedMs: number;
  /** 项目路径 */
  projectPath?: string;
  /** 错误信息（如果 stage 为 error） */
  error?: string;
}

/**
 * 项目加载状态
 */
export interface ProjectLoadState {
  /** 项目路径 */
  path: string;
  /** 加载状态 */
  status: 'loading' | 'ready' | 'error' | 'not_loaded';
  /** 加载耗时（毫秒，仅 ready 状态） */
  loadTime?: number;
  /** 当前进度（仅 loading 状态） */
  progress?: InitProgress;
  /** 最后访问时间 */
  lastAccess: number;
  /** 优先级 */
  priority: number;
}

// ========== Memory Monitoring ==========

export interface MemorySnapshot {
  platform: 'darwin' | 'win32';
  timestamp: number;
  totalMB: number;
  freeMB: number;
  usedPercent: number;
  /** macOS: memory_pressure 解析的 page size */
  pageSize?: number;
  /** macOS: swap 使用量 (MB) */
  swapUsedMB?: number;
  /** macOS: System-wide memory free percentage */
  memoryPressureFreePercent?: number;
  /** Windows: Available MBytes */
  availableMB?: number;
  /** Windows: % Committed Bytes In Use */
  commitPercent?: number;
  /** 数据来源 */
  source: 'memory_pressure' | 'sysctl_swap' | 'perf_counter' | 'cim_instance' | 'node_os';
  /** 采集耗时 (ms) */
  collectionDurationMs?: number;
  /** 采集错误信息 */
  error?: string;
}

export type PressureLevel = 'low' | 'moderate' | 'high' | 'critical' | 'unknown';

// ========== Project Process Memory ==========

export interface ProjectMemorySnapshot {
  projectPath: string;
  pid: number;
  rssMB: number;
  heapUsedMB?: number;
  heapTotalMB?: number;
  timestamp: number;
}

// ========== Auto-Scaling ==========

export interface ScaleAction {
  action: 'relax_capacity' | 'shrink' | 'evict_idle' | 'none';
  reason: string;
  targetProject?: string;
}

export interface ScaleDecision {
  timestamp: number;
  degraded: boolean;
  degradedReason?: string;
  currentCount: number;
  capacity: number;
  pressureLevel: PressureLevel;
  action: ScaleAction;
  snapshotAgeMs?: number;
  snapshotStale?: boolean;
}

export interface AutoScalingConfig {
  enabled: boolean;
  minProjects: number;
  maxProjects: number;
  scaleCooldownSeconds: number;
  checkIntervalSeconds: number;
  idleEvictMinutes: number;
  maxSnapshotAgeMs: number;
  drainTimeoutMs: number;
  collectionTimeoutMs: number;
  memoryThresholds?: Record<string, number>;
}

// ========== Index Progress ==========

export interface IndexProgress {
  stage: 'not_started' | 'in_progress' | 'completed' | 'stalled';
  title?: string;
  percent?: number;
  message?: string;
  lastUpdated: number;
}

// ========== Response Metadata ==========

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
  /** 项目路径诊断信息（当路径不匹配时） */
  diagnosis?: {
    daemon_project: string | null;
    requested_project: string;
    file_path: string | null;
    suggested_project: string | null;
    confidence: 'low' | 'medium' | 'high';
    reason: string;
  };
  /** 符号模式解析后的精确位置 */
  resolvedPosition?: {
    file: string;    // 文件路径
    line: number;    // 1-based 行号
    col: number;     // 1-based 列号
  };
  /** 是否索引已完成（所有 LSP 查询端点附加） */
  indexingComplete?: boolean;
}

export interface CLIResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  elapsed?: number;
  /** 响应元数据，提供关于响应的附加信息 */
  metadata?: ResponseMetadata;
  /** 诊断信息（项目路径不匹配时） */
  diagnosis?: {
    daemon_project: string | null;
    requested_project: string;
    file_path: string | null;
    suggested_project: string | null;
    confidence: 'low' | 'medium' | 'high';
    reason: string;
  };
  /** 修复建议 */
  suggestion?: string;
  /** 修复命令 */
  fix_command?: string | null;
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
  diagnostics: string[];
  diag: string[];  // 别名
  rename: string[];
  semanticTokens: string[];
  semtok: string[];
  inlayHint: string[];
  codeAction: string[];
  documentHighlight: string[];
  codeLens: string[];
  completion: string[];
  signatureHelp: string[];
  declaration: string[];
  decl: string[];
  formatting: string[];
  fmt: string[];
  prepareRename: string[];
  preren: string[];
}

/**
 * 默认紧凑输出字段（每个命令只保留核心字段）
 *
 * SP02：在 definition / references / implementations / typeDefinition / callHierarchy 等
 * 与 jar 类重写相关的命令中新增以下字段：
 *   - originalUri：重写前的 jdt:// URI
 *   - originalRange：重写前的范围
 *   - source：源码来源（jdk-src / sources-jar / decompiled / class-file-contents）
 *   - note：补充说明（如“fallback: java/classFileContents”）
 *   - lockWaitMs：锁等待耗时
 *   - lineMapping：exact / best-effort / n/a
 */
export const COMPACT_FIELDS: CompactFieldConfig = {
  definition: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  references: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  refs: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],  // 别名支持
  symbols: ['name', 'kind', 'detail', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'selectionRange.start.line', 'selectionRange.start.character', 'parent'],
  sym: ['name', 'kind', 'detail', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'selectionRange.start.line', 'selectionRange.start.character', 'parent'],  // 别名支持
  callHierarchy: ['entry', 'calls', 'totalMethods', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  hover: ['contents'],
  implementations: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  impl: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],  // 别名支持
  typeDefinition: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  typedef: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],  // 别名支持
  workspaceSymbols: ['name', 'kind', 'containerName', 'location.uri', 'location.range.start.line', 'location.range.start.character'],
  find: ['name', 'kind', 'containerName', 'location.uri', 'location.range.start.line', 'location.range.start.character'],  // 别名支持
  f: ['name', 'kind', 'containerName', 'location.uri', 'location.range.start.line', 'location.range.start.character'],  // 别名支持
  diagnostics: ['severity', 'message', 'code', 'source', 'tags', 'range.start.line', 'range.start.character'],
  diag: ['severity', 'message', 'code', 'source', 'tags', 'range.start.line', 'range.start.character'],
  rename: ['file', 'range.start.line', 'range.start.character', 'newText'],  // TODO: edits 为嵌套数组，compact 暂按 change 级别处理
  semanticTokens: ['line', 'startChar', 'length', 'tokenType', 'tokenModifiers'],
  semtok: ['line', 'startChar', 'length', 'tokenType', 'tokenModifiers'],
  inlayHint: ['label', 'position.line', 'position.character'],
  codeAction: ['title', 'kind'],
  documentHighlight: ['kind', 'range.start.line', 'range.start.character'],
  codeLens: ['range.start.line', 'command.title'],
  completion: ['label', 'kind', 'detail'],
  signatureHelp: ['label', 'parameters'],
  declaration: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  decl: ['uri', 'range.start.line', 'range.start.character', 'range.end.line', 'range.end.character', 'originalUri', 'originalRange', 'source', 'note', 'lockWaitMs', 'lineMapping'],
  formatting: ['range.start.line', 'range.start.character', 'newText'],
  fmt: ['range.start.line', 'range.start.character', 'newText'],
  prepareRename: ['start.line', 'start.character', 'end.line', 'end.character'],
  preren: ['start.line', 'start.character', 'end.line', 'end.character'],
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

// CompletionItemKind mapping (LSP spec)
export const CompletionItemKindMap: Record<number, string> = {
  1: 'Text',
  2: 'Method',
  3: 'Function',
  4: 'Constructor',
  5: 'Field',
  6: 'Variable',
  7: 'Class',
  8: 'Interface',
  9: 'Module',
  10: 'Property',
  11: 'Unit',
  12: 'Value',
  13: 'Enum',
  14: 'Keyword',
  15: 'Snippet',
  16: 'Color',
  17: 'File',
  18: 'Reference',
  19: 'Folder',
  20: 'EnumMember',
  21: 'Constant',
  22: 'Struct',
  23: 'Event',
  24: 'Operator',
  25: 'TypeParameter',
};

// DocumentHighlightKind mapping (LSP spec)
export const DocumentHighlightKindMap: Record<number, string> = {
  1: 'Text',
  2: 'Read',
  3: 'Write',
};

