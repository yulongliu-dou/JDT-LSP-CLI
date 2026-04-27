/**
 * 符号解析器 - 将符号标识符转换为精确位置
 * 
 * 支持:
 * - 基于符号名称定位（无重载场景）
 * - 基于签名区分重载方法（支持模糊匹配）
 * - 基于容器路径定位嵌套符号（匿名类/Lambda）
 * - 基于索引定位多个同名符号
 * - 泛型类型模糊匹配
 * - 智能位置选择（针对不同命令优化）
 * 
 * 重构说明：
 * 本文件已重构为模块化架构，原有功能已迁移到以下模块：
 * - src/symbolResolver/signature/signatureExtractor.ts - 签名提取和规范化
 * - src/symbolResolver/matching/signatureMatcher.ts - 签名和名称匹配
 * - src/symbolResolver/matching/symbolFinder.ts - 符号查找和遍历
 * - src/symbolResolver/formatting/symbolFormatter.ts - 符号格式化
 * - src/symbolResolver/position/positionOptimizer.ts - 位置优化
 * - src/symbolResolver/core/symbolResolver.ts - 核心解析逻辑
 * 
 * 本文件现在作为入口点，重新导出所有公开 API 以保持向后兼容性
 */

// 重新导出签名处理模块
export {
  extractSignature,
  extractSimpleSignature,
  normalizeGenericType,
  normalizeSignature,
  smartSplitSignature,
  extractReturnType,
  extractSignatureFromName,
} from './symbolResolver/signature/signatureExtractor';

// 重新导出匹配模块
export {
  matchSignature,
  fuzzyMatchName,
} from './symbolResolver/matching/signatureMatcher';

export {
  buildSymbolPath,
  collectAllSymbols,
  findContainer,
  findMatchingSymbols,
  findSimilarNames,
} from './symbolResolver/matching/symbolFinder';

// 重新导出格式化模块
export {
  formatSymbolDescription,
  formatOverloadOption,
} from './symbolResolver/formatting/symbolFormatter';

// 重新导出位置模块
export {
  getOptimalPosition,
  CommandType,
} from './symbolResolver/position/positionOptimizer';

// 重新导出核心模块
export {
  resolveSymbol,
  buildSymbolQuery,
  isSymbolMode,
  SymbolResolveResult,
} from './symbolResolver/core/symbolResolver';
