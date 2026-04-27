/**
 * symbolResolver 核心模块单元测试
 * 
 * 测试符号位置解析的主逻辑（线上实际使用的版本）：
 * - resolveSymbol
 * - buildSymbolQuery
 * - isSymbolMode
 */

import {
  resolveSymbol,
  buildSymbolQuery,
  isSymbolMode,
} from '../../../src/symbolResolver/core/symbolResolver';

describe('symbolResolver/core - 核心功能', () => {
  describe('buildSymbolQuery', () => {
    it('应该从 method 选项构建查询', () => {
      const query = buildSymbolQuery({ method: 'myMethod' });
      expect(query).not.toBeNull();
      expect(query!.name).toBe('myMethod');
    });

    it('应该从 symbol 选项构建查询', () => {
      const query = buildSymbolQuery({ symbol: 'MyClass' });
      expect(query).not.toBeNull();
      expect(query!.name).toBe('MyClass');
    });

    it('method 优先于 symbol', () => {
      const query = buildSymbolQuery({ method: 'myMethod', symbol: 'MyClass' });
      expect(query!.name).toBe('myMethod');
    });

    it('无名称时返回 null', () => {
      const query = buildSymbolQuery({});
      expect(query).toBeNull();
    });

    it('应该解析 index 为数字', () => {
      const query = buildSymbolQuery({ method: 'test', index: '2' });
      expect(query!.index).toBe(2);
    });

    it('应该保留 signature 参数', () => {
      const query = buildSymbolQuery({ method: 'test', signature: '(String)' });
      expect(query!.signature).toBe('(String)');
    });

    it('应该保留 container 参数', () => {
      const query = buildSymbolQuery({ method: 'test', container: 'MyClass' });
      expect(query!.container).toBe('MyClass');
    });

    it('应该保留 kind 参数', () => {
      const query = buildSymbolQuery({ method: 'test', kind: 'Method' });
      expect(query!.kind).toBe('Method');
    });
  });

  describe('isSymbolMode', () => {
    it('有 method 时返回 true', () => {
      expect(isSymbolMode({ method: 'test' })).toBe(true);
    });

    it('有 symbol 时返回 true', () => {
      expect(isSymbolMode({ symbol: 'test' })).toBe(true);
    });

    it('无 method 和 symbol 时返回 false', () => {
      expect(isSymbolMode({})).toBe(false);
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
      const result = resolveSymbol(testSymbols, { name: 'MyClass' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.position.matchedSymbol).toContain('MyClass');
      }
    });

    it('应该解析方法名（有重载时应返回歧义错误）', () => {
      const result = resolveSymbol(testSymbols, { name: 'myMethod' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ambiguous');
      }
    });

    it('应该用 index 消除重载歧义', () => {
      const result = resolveSymbol(testSymbols, { name: 'myMethod', index: 0 });
      expect(result.success).toBe(true);
    });

    it('应该用签名消除重载歧义', () => {
      const result = resolveSymbol(testSymbols, { name: 'myMethod', signature: '(String)' });
      expect(result.success).toBe(true);
    });

    it('未找到符号时返回 not_found 错误', () => {
      const result = resolveSymbol(testSymbols, { name: 'nonExistent' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('not_found');
      }
    });

    it('index 超出范围时返回 invalid_query 错误', () => {
      const result = resolveSymbol(testSymbols, { name: 'myMethod', index: 99 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('invalid_query');
      }
    });

    it('空名称时返回 invalid_query 错误', () => {
      const result = resolveSymbol(testSymbols, { name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('invalid_query');
      }
    });

    it('应该支持大小写不敏感的名称匹配', () => {
      // 版本B增强后应支持
      const result = resolveSymbol(testSymbols, { name: 'myclass' });
      expect(result.success).toBe(true);
    });
  });
});
