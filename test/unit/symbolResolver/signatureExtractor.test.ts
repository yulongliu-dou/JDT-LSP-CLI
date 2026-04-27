/**
 * signatureExtractor 单元测试
 * 
 * 测试签名提取和规范化功能（线上实际使用的版本）：
 * - extractSignature
 * - extractSimpleSignature
 * - normalizeGenericType（循环处理嵌套泛型）
 * - normalizeSignature（智能分割泛型内逗号）
 * - smartSplitSignature
 * - extractReturnType
 * - extractSignatureFromName
 */

import {
  extractSignature,
  extractSimpleSignature,
  normalizeGenericType,
  normalizeSignature,
  smartSplitSignature,
  extractReturnType,
  extractSignatureFromName,
} from '../../../src/symbolResolver/signature/signatureExtractor';

describe('signatureExtractor - 签名提取', () => {
  describe('extractSignature', () => {
    it('应该从完整的方法detail中提取签名', () => {
      expect(extractSignature('myMethod(String orderId, int quantity) : void')).toBe('String orderId, int quantity');
    });

    it('应该处理无参数的方法', () => {
      expect(extractSignature('myMethod() : void')).toBe('');
    });

    it('应该处理泛型参数', () => {
      expect(extractSignature('getList(List<String> items) : List<String>')).toBe('List<String> items');
    });

    it('应该处理undefined输入', () => {
      expect(extractSignature(undefined)).toBe('');
    });

    it('应该处理空字符串', () => {
      expect(extractSignature('')).toBe('');
    });
  });

  describe('extractSimpleSignature', () => {
    it('应该提取简化的签名（只保留类型）', () => {
      expect(extractSimpleSignature('myMethod(String orderId, int quantity) : void')).toBe('(String, int)');
    });

    it('应该处理无参数的方法', () => {
      expect(extractSimpleSignature('myMethod() : void')).toBe('()');
    });

    it('应该规范化泛型类型', () => {
      expect(extractSimpleSignature('process(List<String> items) : void')).toBe('(List)');
    });

    it('应该处理泛型内逗号不被错误分割', () => {
      // 测试智能分割：Map<String, Integer> 不应在泛型内逗号处分割
      expect(extractSimpleSignature('process(Map<String, Integer> map) : void')).toBe('(Map)');
    });
  });

  describe('extractReturnType', () => {
    it('应该提取返回类型', () => {
      expect(extractReturnType('myMethod(String name) : void')).toBe('void');
    });

    it('应该提取带泛型的返回类型', () => {
      expect(extractReturnType('getList() : List<String>')).toBe('List<String>');
    });

    it('应该处理无返回类型的detail', () => {
      expect(extractReturnType('myMethod(String name)')).toBe('');
    });

    it('应该处理undefined', () => {
      expect(extractReturnType(undefined)).toBe('');
    });
  });

  describe('extractSignatureFromName', () => {
    it('应该从方法名中提取签名', () => {
      expect(extractSignatureFromName('resolveTypeHandler(Type, JdbcType, String)')).toBe('(Type, JdbcType, String)');
    });

    it('应该处理无参数的方法名', () => {
      expect(extractSignatureFromName('myMethod')).toBe('()');
    });
  });
});

describe('signatureExtractor - 规范化', () => {
  describe('normalizeGenericType', () => {
    it('应该移除简单泛型参数', () => {
      expect(normalizeGenericType('List<String>')).toBe('List');
    });

    it('应该移除多个泛型参数', () => {
      expect(normalizeGenericType('Map<String, Integer>')).toBe('Map');
    });

    it('应该正确处理嵌套泛型（循环剥洋葱式移除）', () => {
      // 这是版本B的关键修复点：深层嵌套泛型
      expect(normalizeGenericType('Map<String, List<Map<String, Integer>>>')).toBe('Map');
    });

    it('应该处理两层嵌套泛型', () => {
      expect(normalizeGenericType('List<Map<String, Integer>>')).toBe('List');
    });

    it('应该处理非泛型类型', () => {
      expect(normalizeGenericType('String')).toBe('String');
    });

    it('应该处理空字符串', () => {
      expect(normalizeGenericType('')).toBe('');
    });

    it('应该处理数组类型', () => {
      expect(normalizeGenericType('String[]')).toBe('String[]');
    });
  });

  describe('smartSplitSignature', () => {
    it('应该按顶层逗号分割', () => {
      expect(smartSplitSignature('String, int')).toEqual(['String', 'int']);
    });

    it('应该忽略泛型内的逗号', () => {
      // 关键测试：Map<String, Integer> 不应被分割
      expect(smartSplitSignature('Map<String, Integer>, List<String>')).toEqual(['Map<String, Integer>', 'List<String>']);
    });

    it('应该处理深层嵌套泛型', () => {
      expect(smartSplitSignature('Map<String, List<Integer>>, String')).toEqual(['Map<String, List<Integer>>', 'String']);
    });

    it('应该处理空字符串', () => {
      expect(smartSplitSignature('')).toEqual([]);
    });

    it('应该处理单个参数', () => {
      expect(smartSplitSignature('String')).toEqual(['String']);
    });
  });

  describe('normalizeSignature', () => {
    it('应该规范化签名为小写逗号分隔', () => {
      expect(normalizeSignature('String orderId, int quantity')).toBe('string,int');
    });

    it('应该移除参数名', () => {
      expect(normalizeSignature('String, int')).toBe('string,int');
    });

    it('应该正确处理泛型内逗号（智能分割）', () => {
      // 版本B的关键修复：Map<String, Integer> 不应在泛型内逗号处分割
      expect(normalizeSignature('Map<String, Integer>, List<String>')).toBe('map,list');
    });

    it('应该移除泛型参数', () => {
      expect(normalizeSignature('List<String>, Map<String, Integer>')).toBe('list,map');
    });

    it('应该处理空字符串', () => {
      expect(normalizeSignature('')).toBe('');
    });

    it('应该保留stripGenerics=false时的泛型', () => {
      expect(normalizeSignature('List<String>', false)).toBe('list<string>');
    });

    it('应该处理嵌套泛型参数', () => {
      // 嵌套泛型应被完全移除
      expect(normalizeSignature('Map<String, List<Integer>>')).toBe('map');
    });
  });
});
