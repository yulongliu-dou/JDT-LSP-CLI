/**
 * CLI 参数防呆校验组件
 *
 * 为每个命令提供统一的参数格式/范围/组合校验，返回结构化的 CLI 兼容错误输出。
 * Agent 可通过 error code 和 recovery 字段自愈修正调用。
 *
 * 校验层级：
 *   1. 格式校验（整数、枚举值等）
 *   2. 必填/组合校验（required params，互斥选项）
 *   3. 文件存在性校验
 *
 * 使用方式：在命令 .action() 顶部调用对应的 validate* 函数，若返回非 null 则直接 outputResult 输出并退出。
 */

import * as fs from 'fs';
import * as path from 'path';
import { isValidSymbolKind, getSupportedSymbolKinds } from '../../core/utils/symbolKind';

// ── 类型定义 ──

export interface ValidationErrorItem {
  /** 机器可读的错误码，agent 可用于自愈逻辑 */
  code: string;
  /** 人类可读的中文错误描述 */
  message: string;
  /** 恢复建议 */
  suggestion?: string;
  /** 正确用法格式 */
  usage?: string;
  /** 具体示例 */
  examples?: string[];
}

interface InternalResult {
  valid: boolean;
  errors: ValidationErrorItem[];
  warnings: string[];
}

/** CLI 兼容的结构化错误输出，可直接传给 outputResult() */
export interface CLIValidationErrorOutput {
  success: false;
  error: string;
  data: {
    validation: {
      code: string;
      message: string;
      recovery?: {
        suggestion?: string;
        usage?: string;
        examples?: string[];
      };
    };
  };
  elapsed: 0;
}

// ── 内部辅助 ──

function fail(item: ValidationErrorItem): InternalResult {
  return { valid: false, errors: [item], warnings: [] };
}

function ok(warnings?: string[]): InternalResult {
  return { valid: true, errors: [], warnings: warnings || [] };
}

function mergeResults(results: InternalResult[]): InternalResult {
  let allValid = true;
  const allErrors: ValidationErrorItem[] = [];
  const allWarnings: string[] = [];
  for (const r of results) {
    if (!r.valid) allValid = false;
    allErrors.push(...r.errors);
    allWarnings.push(...r.warnings);
  }
  return { valid: allValid, errors: allErrors, warnings: allWarnings };
}

/**
 * 将 InternalResult 转换为 CLI 兼容错误输出（取第一个错误），全部通过时返回 null
 */
export function toCLIError(result: InternalResult): CLIValidationErrorOutput | null {
  if (result.valid) return null;
  const first = result.errors[0];
  return buildCLIError(first.code, first.message, first.suggestion, first.usage, first.examples);
}

function buildCLIError(
  code: string,
  message: string,
  suggestion?: string,
  usage?: string,
  examples?: string[]
): CLIValidationErrorOutput {
  const hasRecovery = suggestion || usage || (examples && examples.length > 0);
  return {
    success: false,
    error: `[${code}] ${message}`,
    data: {
      validation: {
        code,
        message,
        recovery: hasRecovery ? { suggestion, usage, examples } : undefined,
      },
    },
    elapsed: 0,
  };
}

// ── 通用校验器 ──

/** 校验必填参数 */
export function checkRequiredParam(
  value: unknown,
  paramLabel: string,
  usage?: string,
  examples?: string[]
): InternalResult {
  if (value === undefined || value === null || value === '') {
    return fail({
      code: 'MISSING_PARAM',
      message: `缺少必填参数: ${paramLabel}`,
      suggestion: `请提供 ${paramLabel}`,
      usage,
      examples,
    });
  }
  return ok();
}

/** 校验文件存在 */
export function checkFileExists(filePath: string, projectPath?: string): InternalResult {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : (projectPath ? path.resolve(projectPath, filePath) : path.resolve(filePath));

  if (!fs.existsSync(resolved)) {
    return fail({
      code: 'FILE_NOT_FOUND',
      message: `文件不存在: ${resolved}`,
      suggestion: '请确认文件路径正确，支持绝对路径或相对于项目根目录的路径',
    });
  }
  return ok();
}

/** 校验正整数（可选参数，有值时校验；未提供则通过） */
export function checkPositiveInteger(
  value: unknown,
  paramLabel: string,
  min?: number,
  max?: number
): InternalResult {
  if (value === undefined || value === null) return ok();

  const str = String(value);
  const num = parseInt(str, 10);

  if (isNaN(num) || String(num) !== str.trim()) {
    const rangeHint = min !== undefined && max !== undefined ? ` (范围: ${min}-${max})` : '';
    return fail({
      code: 'INVALID_INTEGER',
      message: `${paramLabel} 必须为有效整数，实际输入: "${str}"`,
      suggestion: `请提供有效整数值${rangeHint}`,
    });
  }

  if (min !== undefined && num < min) {
    return fail({
      code: 'VALUE_OUT_OF_RANGE',
      message: `${paramLabel} 取值 ${num} 低于最小值 ${min}`,
      suggestion: `请提供 >= ${min} 的值`,
    });
  }

  if (max !== undefined && num > max) {
    return fail({
      code: 'VALUE_OUT_OF_RANGE',
      message: `${paramLabel} 取值 ${num} 超出最大值 ${max}`,
      suggestion: `请提供 <= ${max} 的值`,
    });
  }

  return ok();
}

/** 校验 SymbolKind 字符串合法性 */
export function checkSymbolKind(kind: string | undefined): InternalResult {
  if (!kind) return ok();

  if (!isValidSymbolKind(kind)) {
    const supported = getSupportedSymbolKinds().join(', ');
    return fail({
      code: 'INVALID_SYMBOL_KIND',
      message: `无效的符号类型: "${kind}"`,
      suggestion: `支持的符号类型: ${supported}`,
    });
  }
  return ok();
}

/** 校验枚举值 */
export function checkEnum(
  value: string | undefined,
  validValues: string[],
  paramLabel: string
): InternalResult {
  if (!value) return ok();

  if (!validValues.includes(value)) {
    return fail({
      code: 'INVALID_ENUM',
      message: `${paramLabel} 无效值: "${value}"`,
      suggestion: `有效值: ${validValues.join(' | ')}`,
    });
  }
  return ok();
}

// ── 命令级校验函数 ──

/** 与 commander OptionValues 兼容的选项类型 */
interface GlobalOpts {
  project?: string;
}

/** symbols <file> */
export function validateSymbolsCommand(
  file: string,
  opts: GlobalOpts
): CLIValidationErrorOutput | null {
  return toCLIError(checkFileExists(file, opts.project));
}

/** find <query> */
export function validateFindCommand(cmdOptions: {
  kind?: string;
  limit?: string;
}): CLIValidationErrorOutput | null {
  return toCLIError(mergeResults([
    checkSymbolKind(cmdOptions.kind),
    checkPositiveInteger(cmdOptions.limit, '--limit', 1, 500),
  ]));
}

/**
 * 文件符号命令通用校验 (def/refs/hover/impl/typedef)
 *
 * 两种模式：
 *   --global: 需要 --symbol/--method + --kind，不需要 file
 *   非global: 需要 file（必须提供且存在），--symbol/--method 由 positionResolver 校验
 */
export function validateFileSymbolCommand(
  file: string | undefined,
  cmdOptions: {
    global?: boolean;
    symbol?: string;
    method?: string;
    kind?: string;
    index?: string;
  },
  opts: GlobalOpts,
  commandLabel: string  // 用于 usage 示例中的命令别名，如 'def', 'refs'
): CLIValidationErrorOutput | null {
  const results: InternalResult[] = [];

  if (cmdOptions.global) {
    // 全局模式: --symbol/--method + --kind 必填
    results.push(checkRequiredParam(
      cmdOptions.symbol || cmdOptions.method,
      '--symbol 或 --method',
      `jls ${commandLabel} --global --symbol <名称> --kind <类型>`,
      [
        `jls ${commandLabel} --global --symbol "ArrayList" --kind Class`,
        `jls ${commandLabel} --global --method "findById" --kind Method`,
      ]
    ));
    results.push(checkRequiredParam(
      cmdOptions.kind,
      '--kind',
      `jls ${commandLabel} --global --symbol <名称> --kind <Method|Class|Field|Interface>`,
    ));
  } else {
    // 非全局模式: file 必填
    if (!file) {
      return buildCLIError(
        'MISSING_PARAM',
        '缺少文件路径',
        '请提供文件路径参数，或使用 --global 模式进行全局搜索',
        `jls ${commandLabel} <文件路径> --symbol <名称>`,
        [
          `jls ${commandLabel} src/main/java/com/example/UserService.java --symbol findById`,
          `jls ${commandLabel} --global --symbol "MyService" --kind Class`,
        ]
      );
    }
    results.push(checkFileExists(file, opts.project));
  }

  results.push(checkSymbolKind(cmdOptions.kind));
  results.push(checkPositiveInteger(cmdOptions.index, '--index', 0, 999));

  return toCLIError(mergeResults(results));
}

/** call-hierarchy [file] */
export function validateCallHierarchyCommand(
  file: string | undefined,
  cmdOptions: {
    mode?: string;
    depth?: string;
    cursor?: string;
    fetchSource?: string;
    expandDepth?: string;
    maxSummaryDepth?: string;
    global?: boolean;
    symbol?: string;
    method?: string;
    kind?: string;
  },
  opts: GlobalOpts
): CLIValidationErrorOutput | null {
  const results: InternalResult[] = [];

  // mode 枚举校验
  results.push(checkEnum(cmdOptions.mode, ['legacy', 'lazy', 'snapshot', 'summary'], '--mode'));

  // depth 范围校验
  results.push(checkPositiveInteger(cmdOptions.depth, '--depth', 0, 20));

  // max-summary-depth 范围校验
  results.push(checkPositiveInteger(cmdOptions.maxSummaryDepth, '--max-summary-depth', 1, 10));

  // cursor 相关选项必须配合 --cursor
  const isCursorMode = !!cmdOptions.cursor;

  // cursor 模式不能配合 --mode legacy（legacy 模式不处理 cursor）
  if (isCursorMode && cmdOptions.mode === 'legacy') {
    return buildCLIError(
      'INVALID_COMBINATION',
      '--cursor 不能配合 --mode legacy 使用',
      '--cursor 仅适用于 lazy / snapshot / summary 模式，请指定 --mode lazy|snapshot|summary',
      'jls ch --mode lazy --symbol <名称> --kind Method',
      [
        'jls ch --mode lazy --symbol "MyClass.myMethod" --kind Method',
        'jls ch --mode lazy --cursor <cursor-id>',
      ],
    );
  }

  if (cmdOptions.fetchSource && !isCursorMode) {
    results.push(fail({
      code: 'MISSING_PARAM',
      message: '--fetch-source 需要配合 --cursor 使用',
      suggestion: '先从 lazy/snapshot/summary 模式的返回结果中获取 cursor ID，再通过 --cursor 续查',
    }));
  }
  if (cmdOptions.expandDepth && !isCursorMode) {
    results.push(fail({
      code: 'MISSING_PARAM',
      message: '--expand-depth 需要配合 --cursor 使用',
      suggestion: '先从 lazy/snapshot/summary 模式的返回结果中获取 cursor ID，再通过 --cursor 续查',
    }));
  }

  // 非 cursor 模式需要文件或符号位置
  if (!isCursorMode) {
    if (cmdOptions.global) {
      results.push(checkRequiredParam(
        cmdOptions.symbol || cmdOptions.method,
        '--symbol 或 --method',
        'jls ch --global --symbol <名称> --kind Method',
      ));
      results.push(checkRequiredParam(cmdOptions.kind, '--kind'));
      results.push(checkSymbolKind(cmdOptions.kind));
    } else if (!file) {
      return buildCLIError(
        'MISSING_PARAM',
        '缺少文件路径或 --cursor',
        '请提供文件路径、--global 模式、或通过 --cursor 续查',
        'jls ch <文件路径> --symbol <名称>\njls ch --global --symbol <名称> --kind Method\njls ch --mode lazy --cursor <id>',
      );
    } else {
      results.push(checkFileExists(file, opts.project));
      results.push(checkSymbolKind(cmdOptions.kind));
    }
  }

  return toCLIError(mergeResults(results));
}

// ── Cache 子命令校验 ──

export function validateCacheStatsCommand(cmdOptions: {
  format?: string;
}): CLIValidationErrorOutput | null {
  return toCLIError(checkEnum(cmdOptions.format, ['table', 'json'], '--format'));
}

export function validateCacheCleanCommand(cmdOptions: {
  stale?: boolean;
  all?: boolean;
  cacheTtlDays?: string;
}): CLIValidationErrorOutput | null {
  if (cmdOptions.stale && cmdOptions.all) {
    return buildCLIError(
      'MUTUALLY_EXCLUSIVE',
      '--stale 和 --all 不能同时使用',
      '请选择其中一个清理策略',
      'jls cache clean --stale',
      ['jls cache clean --stale', 'jls cache clean --all']
    );
  }
  return toCLIError(checkPositiveInteger(cmdOptions.cacheTtlDays, '--cache-ttl-days', 0));
}

export function validateCacheWarmCommand(cmdOptions: {
  timeout?: string;
}): CLIValidationErrorOutput | null {
  return toCLIError(checkPositiveInteger(cmdOptions.timeout, '--timeout', 1000));
}

/** formatting <file> */
export function validateFormattingCommand(
  file: string,
  opts: GlobalOpts
): CLIValidationErrorOutput | null {
  if (!file) {
    return buildCLIError(
      'MISSING_PARAM',
      '缺少文件路径',
      '请提供需要格式化的 Java 文件路径',
      'jls fmt <文件路径>',
      ['jls fmt src/main/java/com/example/Service.java']
    );
  }
  return toCLIError(checkFileExists(file, opts.project));
}

/** code-lens <file> */
export function validateCodeLensCommand(
  file: string,
  opts: GlobalOpts
): CLIValidationErrorOutput | null {
  if (!file) {
    return buildCLIError('MISSING_PARAM', '缺少文件路径', '请提供 Java 文件路径', 'jls lens <文件路径>');
  }
  return toCLIError(checkFileExists(file, opts.project));
}

/** diagnostics <file> */
export function validateDiagnosticsCommand(
  file: string,
  opts: GlobalOpts
): CLIValidationErrorOutput | null {
  if (!file) {
    return buildCLIError(
      'MISSING_PARAM',
      '缺少文件路径',
      '请提供需要诊断的 Java 文件路径',
      'jls diag <文件路径>',
      ['jls diag src/main/java/com/example/Service.java']
    );
  }
  return toCLIError(checkFileExists(file, opts.project));
}

/** rename <file> */
export function validateRenameCommand(
  file: string,
  cmdOptions: {
    newName?: string;
    global?: boolean;
    symbol?: string;
    method?: string;
    kind?: string;
    index?: string;
  },
  opts: GlobalOpts
): CLIValidationErrorOutput | null {
  // --new-name 必填
  if (!cmdOptions.newName) {
    return buildCLIError(
      'MISSING_PARAM',
      '缺少 --new-name 参数',
      '语义重命名必须指定新名称',
      'jls rename <文件路径> --symbol <名称> --new-name <新名称>',
      [
        'jls rename Service.java --symbol oldMethod --new-name newMethod',
        'jls rename Service.java --symbol myField --kind Field --new-name renamedField',
      ]
    );
  }

  // 复用文件符号命令通用校验
  return validateFileSymbolCommand(
    file,
    {
      global: cmdOptions.global,
      symbol: cmdOptions.symbol,
      method: cmdOptions.method,
      kind: cmdOptions.kind,
      index: cmdOptions.index,
    },
    opts,
    'rename'
  );
}
