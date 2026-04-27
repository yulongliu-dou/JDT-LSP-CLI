/**
 * 符号解析服务
 * 
 * 本文件现在作为兼容层，所有核心实现已迁移到 symbolResolver/ 模块：
 * - symbolResolver/signature/signatureExtractor.ts - 签名提取和规范化
 * - symbolResolver/matching/signatureMatcher.ts - 签名和名称匹配
 * - symbolResolver/matching/symbolFinder.ts - 符号查找和遍历
 * - symbolResolver/formatting/symbolFormatter.ts - 符号格式化
 * - symbolResolver/position/positionOptimizer.ts - 位置优化
 * - symbolResolver/core/symbolResolver.ts - 核心解析逻辑
 * 
 * 本文件重新导出所有公开 API 以保持向后兼容性
 */

// 重新导出签名处理模块
export {
  extractSignature,
  extractSimpleSignature,
  normalizeGenericType,
  normalizeSignature,
  extractReturnType,
  extractSignatureFromName,
} from '../symbolResolver/signature/signatureExtractor';

// 重新导出匹配模块
export {
  matchSignature,
  fuzzyMatchName,
} from '../symbolResolver/matching/signatureMatcher';

// 重新导出格式化模块
export {
  formatSymbolDescription,
  formatOverloadOption,
} from '../symbolResolver/formatting/symbolFormatter';

// 重新导出位置模块
export {
  getOptimalPosition,
  CommandType,
} from '../symbolResolver/position/positionOptimizer';

// 重新导出核心模块
export {
  resolveSymbol,
  buildSymbolQuery,
  isSymbolMode,
  SymbolResolveResult,
} from '../symbolResolver/core/symbolResolver';

// 导入需要的类型和函数用于 SymbolService 类
import { SymbolQuery, SymbolInfo } from '../core/types';
import { resolveSymbol as resolveSymbolImpl, buildSymbolQuery as buildSymbolQueryImpl, isSymbolMode as isSymbolModeImpl, SymbolResolveResult as SymbolResolveResultType } from '../symbolResolver/core/symbolResolver';
import type { CommandType as CommandTypeType } from '../symbolResolver/position/positionOptimizer';

/**
 * 符号解析服务类
 * 保留此类以保持向后兼容性，内部委托给 symbolResolver 模块化实现
 */
export class SymbolService {
  /**
   * 解析符号位置
   */
  resolveSymbol(
    symbols: SymbolInfo[],
    query: SymbolQuery,
    command: CommandTypeType = 'definition'
  ): SymbolResolveResultType {
    return resolveSymbolImpl(symbols, query, command);
  }

  /**
   * 从命令行选项构建 SymbolQuery
   */
  buildSymbolQuery(options: {
    method?: string;
    symbol?: string;
    container?: string;
    signature?: string;
    index?: string | number;
    kind?: string;
  }): SymbolQuery | null {
    return buildSymbolQueryImpl(options);
  }

  /**
   * 检查是否使用符号定位模式
   */
  isSymbolMode(options: {
    method?: string;
    symbol?: string;
  }): boolean {
    return isSymbolModeImpl(options);
  }
}
