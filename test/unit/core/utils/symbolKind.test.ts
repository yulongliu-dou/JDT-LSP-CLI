/**
 * core/utils/symbolKind 单元测试
 * 
 * 测试 SymbolKind 转换函数
 */

import { symbolKindToString, stringToSymbolKind } from '../../../../src/core/utils/symbolKind';

describe('symbolKind 转换', () => {
  describe('symbolKindToString', () => {
    it('应该将 File (1) 转换为字符串', () => {
      expect(symbolKindToString(1)).toBe('File');
    });

    it('应该将 Module (2) 转换为字符串', () => {
      expect(symbolKindToString(2)).toBe('Module');
    });

    it('应该将 Class (5) 转换为字符串', () => {
      expect(symbolKindToString(5)).toBe('Class');
    });

    it('应该将 Method (6) 转换为字符串', () => {
      expect(symbolKindToString(6)).toBe('Method');
    });

    it('应该将 Field (8) 转换为字符串', () => {
      expect(symbolKindToString(8)).toBe('Field');
    });

    it('应该将 Interface (11) 转换为字符串', () => {
      expect(symbolKindToString(11)).toBe('Interface');
    });

    it('应该将 Enum (10) 转换为字符串', () => {
      expect(symbolKindToString(10)).toBe('Enum');
    });

    it('应该处理 undefined 输入', () => {
      expect(symbolKindToString(undefined)).toBe('Unknown');
    });

    it('应该处理 null 输入', () => {
      expect(symbolKindToString(null as any)).toBe('Unknown');
    });

    it('应该处理无效的类型编号', () => {
      expect(symbolKindToString(999)).toBe('Unknown(999)');
    });

    it('应该直接返回字符串输入', () => {
      expect(symbolKindToString('CustomType')).toBe('CustomType');
    });
  });

  describe('stringToSymbolKind', () => {
    it('应该将 File 字符串转换为数字', () => {
      expect(stringToSymbolKind('File')).toBe(1);
    });

    it('应该忽略大小写 - 小写', () => {
      expect(stringToSymbolKind('class')).toBe(5);
    });

    it('应该忽略大小写 - 大写', () => {
      expect(stringToSymbolKind('CLASS')).toBe(5);
    });

    it('应该将 Class 转换为数字', () => {
      expect(stringToSymbolKind('Class')).toBe(5);
    });

    it('应该将 Method 转换为数字', () => {
      expect(stringToSymbolKind('Method')).toBe(6);
    });

    it('应该将 Field 转换为数字', () => {
      expect(stringToSymbolKind('Field')).toBe(8);
    });

    it('应该将 Interface 转换为数字', () => {
      expect(stringToSymbolKind('Interface')).toBe(11);
    });

    it('应该将 Enum 转换为数字', () => {
      expect(stringToSymbolKind('Enum')).toBe(10);
    });

    it('应该处理无效字符串', () => {
      expect(stringToSymbolKind('Invalid')).toBeUndefined();
    });

    it('应该处理空字符串', () => {
      expect(stringToSymbolKind('')).toBeUndefined();
    });
  });

  describe('双向转换', () => {
    it('应该支持往返转换 - 数字到字符串再到数字', () => {
      const kinds = [1, 5, 6, 8, 10, 11]; // File, Class, Method, Field, Enum, Interface

      kinds.forEach(kind => {
        const str = symbolKindToString(kind);
        const back = stringToSymbolKind(str);
        expect(back).toBe(kind);
      });
    });

    it('应该支持往返转换 - 字符串到数字再到字符串', () => {
      const names = ['Class', 'Method', 'Field', 'Interface', 'Enum'];

      names.forEach(name => {
        const num = stringToSymbolKind(name);
        expect(num).toBeDefined();
        if (num !== undefined) {
          const back = symbolKindToString(num);
          expect(back).toBe(name);
        }
      });
    });
  });
});
