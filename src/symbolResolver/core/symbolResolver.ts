/**
 * 核心符号解析
 * 
 * 提供符号位置解析的主逻辑
 */

import { SymbolQuery, ResolvedPosition, SymbolResolutionError, SymbolInfo } from '../../core/types';
import { findMatchingSymbols, findSimilarNames, collectAllSymbols } from '../matching/symbolFinder';
import { getOptimalPosition, CommandType } from '../position/positionOptimizer';
import { formatSymbolDescription, formatOverloadOption } from '../formatting/symbolFormatter';

/**
 * 符号解析结果（成功或失败）
 */
export type SymbolResolveResult = 
  | { success: true; position: ResolvedPosition }
  | { success: false; error: SymbolResolutionError };

/**
 * 解析符号位置
 * 
 * @param symbols - documentSymbol 返回的符号树
 * @param query - 符号查询参数
 * @param command - 命令类型（用于智能位置选择）
 * @returns 解析结果（成功返回位置，失败返回错误信息）
 */
export function resolveSymbol(
  symbols: SymbolInfo[],
  query: SymbolQuery,
  command: CommandType = 'definition'
): SymbolResolveResult {
  // 验证查询参数
  if (!query.name || query.name.trim() === '') {
    return {
      success: false,
      error: {
        type: 'invalid_query',
        message: 'Symbol name is required',
      },
    };
  }
  
  // 查找匹配的符号
  const matches = findMatchingSymbols(symbols, query);
  
  // 无匹配
  if (matches.length === 0) {
    const similarNames = findSimilarNames(symbols, query.name, 5, formatSymbolDescription);
    const allSymbols = collectAllSymbols(symbols);
    
    return {
      success: false,
      error: {
        type: 'not_found',
        message: `Symbol '${query.name}' not found${query.container ? ` in container '${query.container}'` : ''}`,
        suggestions: {
          similarNames: similarNames.length > 0 ? similarNames : undefined,
          availableSymbols: allSymbols.slice(0, 20).map(({ symbol, path }) => 
            formatSymbolDescription(symbol, path)
          ),
        },
      },
    };
  }
  
  // 唯一匹配 - 直接返回（模糊匹配的核心优化）
  if (matches.length === 1) {
    const match = matches[0];
    const pos = getOptimalPosition(match.symbol, command);
    return {
      success: true,
      position: {
        line: pos.line,
        character: pos.character,
        confidence: 'exact',
        matchedSymbol: match.path,
      },
    };
  }
  
  // 多个匹配，需要进一步消歧
  // 如果指定了索引，使用索引选择
  if (query.index !== undefined) {
    if (query.index < 0 || query.index >= matches.length) {
      return {
        success: false,
        error: {
          type: 'invalid_query',
          message: `Index ${query.index} out of range. Found ${matches.length} matches (0-${matches.length - 1}).`,
          suggestions: {
            overloadOptions: matches.map(({ symbol, path }, idx) => 
              formatOverloadOption(symbol, path, idx)
            ),
          },
        },
      };
    }
    
    const selected = matches[query.index];
    const pos = getOptimalPosition(selected.symbol, command);
    return {
      success: true,
      position: {
        line: pos.line,
        character: pos.character,
        confidence: 'exact',
        matchedSymbol: selected.path,
      },
    };
  }
  
  // 未指定索引且有多个匹配，返回歧义错误（提供简化签名帮助 AI 选择）
  return {
    success: false,
    error: {
      type: 'ambiguous',
      message: `Found ${matches.length} symbols named '${query.name}'. Use --signature or --index to disambiguate.`,
      suggestions: {
        overloadOptions: matches.map(({ symbol, path }, idx) => 
          formatOverloadOption(symbol, path, idx)
        ),
      },
    },
  };
}

/**
 * 从命令行选项构建 SymbolQuery
 */
export function buildSymbolQuery(options: {
  method?: string;
  symbol?: string;
  container?: string;
  signature?: string;
  index?: string | number;
  kind?: string;
}): SymbolQuery | null {
  const name = options.method || options.symbol;
  if (!name) return null;
  
  return {
    name,
    kind: options.kind,
    container: options.container,
    signature: options.signature,
    index: options.index !== undefined ? parseInt(String(options.index), 10) : undefined,
  };
}

/**
 * 检查是否使用符号定位模式
 */
export function isSymbolMode(options: {
  method?: string;
  symbol?: string;
}): boolean {
  return !!(options.method || options.symbol);
}
