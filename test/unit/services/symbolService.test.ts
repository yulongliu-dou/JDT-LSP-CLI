/**
 * symbolResolver 单元测试
 * 
 * 测试符号解析服务的核心功能（实现已统一到 symbolResolver 模块）：
 * - 签名提取
 * - 签名规范化
 * - 签名匹配
 * - 模糊匹配
 * 
 * 注意：import 路径指向 symbolResolver（实际线上使用的版本），
 * 而非 symbolService（仅作为兼容层重导出）
 */

import {
  extractSignature,
  extractSimpleSignature,
  normalizeGenericType,
  normalizeSignature,
  matchSignature,
  fuzzyMatchName,
} from '../../../src/symbolResolver';

import {
  SymbolService,
} from '../../../src/services/symbolService';

describe('symbolService - 签名提取', () => {
  describe('extractSignature', () => {
    it('应该从完整的方法detail中提取签名', () => {
      const detail = 'myMethod(String orderId, int quantity) : void';
      expect(extractSignature(detail)).toBe('String orderId, int quantity');
    });

    it('应该处理无参数的方法', () => {
      const detail = 'myMethod() : void';
      expect(extractSignature(detail)).toBe('');
    });

    it('应该处理泛型参数', () => {
      const detail = 'getList(List<String> items) : List<String>';
      expect(extractSignature(detail)).toBe('List<String> items');
    });

    it('应该处理多个泛型参数', () => {
      const detail = 'process(Map<String, Integer> map, List<Object> list) : void';
      expect(extractSignature(detail)).toBe('Map<String, Integer> map, List<Object> list');
    });

    it('应该处理undefined输入', () => {
      expect(extractSignature(undefined)).toBe('');
    });

    it('应该处理空字符串', () => {
      expect(extractSignature('')).toBe('');
    });

    it('应该处理没有括号的情况', () => {
      expect(extractSignature('myMethod')).toBe('');
    });

    it('应该处理嵌套泛型', () => {
      const detail = 'process(Map<String, List<Integer>> map) : void';
      expect(extractSignature(detail)).toBe('Map<String, List<Integer>> map');
    });
  });

  describe('extractSimpleSignature', () => {
    it('应该提取简化的签名（只保留类型）', () => {
      const detail = 'myMethod(String orderId, int quantity) : void';
      expect(extractSimpleSignature(detail)).toBe('(String, int)');
    });

    it('应该处理无参数的方法', () => {
      const detail = 'myMethod() : void';
      expect(extractSimpleSignature(detail)).toBe('()');
    });

    it('应该规范化泛型类型', () => {
      const detail = 'process(List<String> items) : void';
      expect(extractSimpleSignature(detail)).toBe('(List)');
    });

    it('应该处理多个参数', () => {
      const detail = 'process(String name, int age, boolean active) : void';
      expect(extractSimpleSignature(detail)).toBe('(String, int, boolean)');
    });

    it('应该处理undefined输入', () => {
      expect(extractSimpleSignature(undefined)).toBe('()');
    });
  });
});

describe('symbolService - 签名规范化', () => {
  describe('normalizeGenericType', () => {
    it('应该移除简单泛型参数', () => {
      expect(normalizeGenericType('List<String>')).toBe('List');
    });

    it('应该移除多个泛型参数', () => {
      expect(normalizeGenericType('Map<String, Integer>')).toBe('Map');
    });

    it('应该处理嵌套泛型', () => {
      expect(normalizeGenericType('Map<String, List<Integer>>')).toBe('Map');
    });

    it('应该处理非泛型类型', () => {
      expect(normalizeGenericType('String')).toBe('String');
    });

    it('应该处理空字符串', () => {
      expect(normalizeGenericType('')).toBe('');
    });

    it('应该处理undefined', () => {
      expect(normalizeGenericType(undefined as any)).toBe('');
    });

    it('应该处理数组类型', () => {
      expect(normalizeGenericType('String[]')).toBe('String[]');
    });
  });

  describe('normalizeSignature', () => {
    it('应该规范化签名为小写逗号分隔', () => {
      expect(normalizeSignature('String orderId, int quantity')).toBe('string,int');
    });

    it('应该移除参数名', () => {
      expect(normalizeSignature('String, int')).toBe('string,int');
    });

    it('应该移除泛型参数', () => {
      // 修复：嵌套泛型会被完全移除
      expect(normalizeSignature('List<String>, Map<String, Integer>')).toBe('list,map');
    });

    it('应该处理空格', () => {
      expect(normalizeSignature('  String  ,  int  ')).toBe('string,int');
    });

    it('应该处理空字符串', () => {
      expect(normalizeSignature('')).toBe('');
    });

    it('应该保留stripGenerics=false时的泛型', () => {
      expect(normalizeSignature('List<String>', false)).toBe('list<string>');
    });
  });
});

describe('symbolService - 签名匹配', () => {
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

    it('应该支持前缀匹配（参数数量不同时查询为符号前缀）', () => {
      // 设计行为：允许前缀匹配，用于支持渐进式搜索
      // 'String' 是 'String, int' 的规范化前缀
      expect(matchSignature('String, int', 'String')).toBe(true);
    });

    it('应该拒绝非前缀的不匹配签名', () => {
      // 'int' 不是 'String, int' 的前缀
      expect(matchSignature('String, int', 'int')).toBe(false);
    });

    it('应该处理空签名', () => {
      expect(matchSignature('', '')).toBe(true);
    });

    it('应该处理 symbolDetail 为 undefined 但有 symbolName 的情况', () => {
      // 当 symbolDetail 无法提取签名时，使用 symbolName
      expect(matchSignature(undefined, 'String', 'myMethod(String)')).toBe(true);
    });

    it('应该处理 symbolDetail 本身是纯签名的情况', () => {
      // 没有括号的纯签名如 'String, int'
      expect(matchSignature('String, int', 'String, int')).toBe(true);
    });

    it('应该匹配带空格的签名', () => {
      expect(matchSignature('  String  ,  int  ', 'String,int')).toBe(true);
    });
  });
});

describe('symbolService - 模糊名称匹配', () => {
  describe('fuzzyMatchName', () => {
    it('应该精确匹配名称', () => {
      expect(fuzzyMatchName('myMethod', 'myMethod')).toBe(true);
    });

    it('应该忽略大小写', () => {
      expect(fuzzyMatchName('mymethod', 'MyMethod')).toBe(true);
    });

    it('应该支持前缀匹配', () => {
      expect(fuzzyMatchName('my', 'myMethod')).toBe(true);
    });

    it('应该支持部分匹配', () => {
      expect(fuzzyMatchName('Method', 'myMethod')).toBe(true);
    });

    it('应该拒绝完全不匹配', () => {
      expect(fuzzyMatchName('abc', 'xyz')).toBe(false);
    });

    it('应该处理空字符串', () => {
      expect(fuzzyMatchName('', '')).toBe(true);
    });

    it('应该匹配驼峰命名', () => {
      expect(fuzzyMatchName('processOrder', 'processOrder')).toBe(true);
    });

    it('应该支持下划线分隔', () => {
      expect(fuzzyMatchName('process_order', 'processOrder')).toBe(true);
    });

    it('应该处理一个为空另一个不为空', () => {
      expect(fuzzyMatchName('method', '')).toBe(false);
      expect(fuzzyMatchName('', 'method')).toBe(false);
    });
  });
});

describe('symbolService - SymbolService 类', () => {
  let service: SymbolService;

  beforeEach(() => {
    service = new SymbolService();
  });

  describe('buildSymbolQuery', () => {
    it('应该从 method 选项构建查询', () => {
      const query = service.buildSymbolQuery({ method: 'myMethod' });
      expect(query).not.toBeNull();
      expect(query!.name).toBe('myMethod');
    });

    it('应该从 symbol 选项构建查询', () => {
      const query = service.buildSymbolQuery({ symbol: 'MyClass' });
      expect(query).not.toBeNull();
      expect(query!.name).toBe('MyClass');
    });

    it('method 优先于 symbol', () => {
      const query = service.buildSymbolQuery({ method: 'myMethod', symbol: 'MyClass' });
      expect(query!.name).toBe('myMethod');
    });

    it('无名称时返回 null', () => {
      const query = service.buildSymbolQuery({});
      expect(query).toBeNull();
    });

    it('应该解析 index 为数字', () => {
      const query = service.buildSymbolQuery({ method: 'test', index: '2' });
      expect(query!.index).toBe(2);
    });
  });

  describe('isSymbolMode', () => {
    it('有 method 时返回 true', () => {
      expect(service.isSymbolMode({ method: 'test' })).toBe(true);
    });

    it('有 symbol 时返回 true', () => {
      expect(service.isSymbolMode({ symbol: 'test' })).toBe(true);
    });

    it('无 method 和 symbol 时返回 false', () => {
      expect(service.isSymbolMode({})).toBe(false);
    });
  });

  describe('resolveSymbol', () => {
    // 构造测试用符号数据
    const testSymbols = [
      {
        name: 'MyClass',
        kind: 'Class',
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        children: [
          {
            name: 'myMethod',
            kind: 'Method',
            detail: 'myMethod(String name, int value) : void',
            range: { start: { line: 2, character: 4 }, end: { line: 5, character: 5 } },
            selectionRange: { start: { line: 2, character: 12 }, end: { line: 2, character: 20 } },
          },
          {
            name: 'myMethod',
            kind: 'Method',
            detail: 'myMethod() : void',
            range: { start: { line: 6, character: 4 }, end: { line: 8, character: 5 } },
            selectionRange: { start: { line: 6, character: 12 }, end: { line: 6, character: 20 } },
          },
        ],
      },
    ];

    it('应该解析唯一的类名', () => {
      const result = service.resolveSymbol(testSymbols, { name: 'MyClass' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.position.matchedSymbol).toContain('MyClass');
      }
    });

    it('应该解析方法名（有重载时应返回歧义错误）', () => {
      const result = service.resolveSymbol(testSymbols, { name: 'myMethod' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ambiguous');
      }
    });

    it('应该用 index 消除重载歧义', () => {
      const result = service.resolveSymbol(testSymbols, { name: 'myMethod', index: 0 });
      expect(result.success).toBe(true);
    });

    it('应该用签名消除重载歧义', () => {
      const result = service.resolveSymbol(testSymbols, { name: 'myMethod', signature: '(String)' });
      expect(result.success).toBe(true);
    });

    it('未找到符号时返回 not_found 错误', () => {
      const result = service.resolveSymbol(testSymbols, { name: 'nonExistent' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('not_found');
      }
    });

    it('index 超出范围时返回 invalid_query 错误', () => {
      const result = service.resolveSymbol(testSymbols, { name: 'myMethod', index: 99 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('invalid_query');
      }
    });

    it('空名称时返回 invalid_query 错误', () => {
      const result = service.resolveSymbol(testSymbols, { name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('invalid_query');
      }
    });
  });
});
