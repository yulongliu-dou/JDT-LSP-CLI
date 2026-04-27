/**
 * signatureMatcher 单元测试
 * 
 * 测试签名和名称匹配功能（线上实际使用的版本）：
 * - matchSignature（统一后的startsWith策略）
 * - fuzzyMatchName（增强版：大小写不敏感、子串、驼峰转换）
 */

import {
  matchSignature,
  fuzzyMatchName,
} from '../../../src/symbolResolver/matching/signatureMatcher';

describe('signatureMatcher - 签名匹配', () => {
  describe('matchSignature', () => {
    it('应该精确匹配签名', () => {
      expect(matchSignature('String, int', 'String, int')).toBe(true);
    });

    it('应该匹配带括号的签名', () => {
      expect(matchSignature('(String, int)', 'String, int')).toBe(true);
    });

    it('应该忽略大小写', () => {
      expect(matchSignature('string, int', 'String, Int')).toBe(true);
    });

    it('应该忽略参数名', () => {
      expect(matchSignature('String orderId, int quantity', 'String, int')).toBe(true);
    });

    it('应该匹配泛型类型（移除泛型参数）', () => {
      expect(matchSignature('List<String>', 'List')).toBe(true);
    });

    it('应该拒绝不匹配的签名', () => {
      expect(matchSignature('String, int', 'String, String')).toBe(false);
    });

    it('应该支持前缀匹配（查询为符号签名的前缀）', () => {
      // startsWith策略：'String' 是 'String,int' 的前缀
      expect(matchSignature('String, int', 'String')).toBe(true);
    });

    it('应该拒绝非前缀的不匹配签名', () => {
      // startsWith策略：'int' 不是 'String,int' 的前缀
      // 这是与旧版includes策略的关键区别
      expect(matchSignature('String, int', 'int')).toBe(false);
    });

    it('应该处理空签名', () => {
      expect(matchSignature('', '')).toBe(true);
    });

    it('应该处理 symbolDetail 为 undefined 但有 symbolName 的情况', () => {
      expect(matchSignature(undefined, 'String', 'myMethod(String)')).toBe(true);
    });

    it('应该处理 symbolDetail 本身是纯签名的情况', () => {
      // 当 detail 不是方法格式时，直接作为签名使用
      expect(matchSignature('String, int', 'String, int')).toBe(true);
    });

    it('应该正确处理泛型内逗号', () => {
      // Map<String, Integer> 不应在泛型内逗号处分割
      expect(matchSignature('Map<String, Integer>, List<String>', 'Map, List')).toBe(true);
    });
  });
});

describe('signatureMatcher - 模糊名称匹配', () => {
  describe('fuzzyMatchName', () => {
    it('应该精确匹配名称', () => {
      expect(fuzzyMatchName('myMethod', 'myMethod')).toBe(true);
    });

    it('应该忽略大小写', () => {
      // 版本B的关键增强：大小写不敏感
      expect(fuzzyMatchName('mymethod', 'MyMethod')).toBe(true);
    });

    it('应该支持前缀匹配', () => {
      expect(fuzzyMatchName('my', 'myMethod')).toBe(true);
    });

    it('应该支持部分匹配（子串匹配）', () => {
      // 版本B的关键增强：子串匹配
      expect(fuzzyMatchName('Method', 'myMethod')).toBe(true);
    });

    it('应该拒绝完全不匹配', () => {
      expect(fuzzyMatchName('abc', 'xyz')).toBe(false);
    });

    it('应该处理两个空字符串', () => {
      // 版本B的关键增强：两个空字符串返回 true
      expect(fuzzyMatchName('', '')).toBe(true);
    });

    it('应该支持下划线转驼峰匹配', () => {
      // 版本B的关键增强：驼峰↔下划线
      expect(fuzzyMatchName('process_order', 'processOrder')).toBe(true);
    });

    it('应该处理一个为空另一个不为空', () => {
      expect(fuzzyMatchName('method', '')).toBe(false);
      expect(fuzzyMatchName('', 'method')).toBe(false);
    });

    it('应该支持泛型类名匹配', () => {
      expect(fuzzyMatchName('List<String>', 'List')).toBe(true);
    });

    it('应该支持大小写不敏感的泛型匹配', () => {
      expect(fuzzyMatchName('list<string>', 'List')).toBe(true);
    });

    it('应该支持大小写不敏感的前缀匹配', () => {
      expect(fuzzyMatchName('SELECT', 'selectOne')).toBe(true);
    });

    it('应该支持部分名称查询（如 selectone 匹配 selectOne）', () => {
      // 用户输入小写 --method selectone 时应能匹配到 selectOne
      expect(fuzzyMatchName('selectOne', 'selectone')).toBe(true);
    });
  });
});
