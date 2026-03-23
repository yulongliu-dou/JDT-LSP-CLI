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
