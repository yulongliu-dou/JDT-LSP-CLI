/**
 * core/utils/symbolKind 单元测试
 * 
 * 测试 SymbolKind 转换函数
 */

import { symbolKindToString, stringToSymbolKind, isValidSymbolKind, getSupportedSymbolKinds, getSymbolKindDisplay } from '../../../../src/core/utils/symbolKind';

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

    it('应该忽略大小写 - 全大写', () => {
      expect(stringToSymbolKind('CLASS')).toBe(5);
    });

    it('应该忽略大小写 - 混合大小写', () => {
      expect(stringToSymbolKind('cLaSs')).toBe(5);
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

  describe('isValidSymbolKind', () => {
    it('应该验证有效的数字 SymbolKind', () => {
      expect(isValidSymbolKind(1)).toBe(true);
      expect(isValidSymbolKind(5)).toBe(true);
      expect(isValidSymbolKind(26)).toBe(true);
    });

    it('应该拒绝无效的数字 SymbolKind', () => {
      expect(isValidSymbolKind(0)).toBe(false);
      expect(isValidSymbolKind(27)).toBe(false);
      expect(isValidSymbolKind(-1)).toBe(false);
    });

    it('应该验证有效的字符串 SymbolKind', () => {
      expect(isValidSymbolKind('Class')).toBe(true);
      expect(isValidSymbolKind('Method')).toBe(true);
    });

    it('应该拒绝无效的字符串 SymbolKind', () => {
      expect(isValidSymbolKind('Invalid')).toBe(false);
      expect(isValidSymbolKind('')).toBe(false);
    });
  });

  describe('getSupportedSymbolKinds', () => {
    it('应该返回所有26种 SymbolKind', () => {
      const kinds = getSupportedSymbolKinds();
      expect(kinds.length).toBe(26);
    });

    it('应该包含核心类型', () => {
      const kinds = getSupportedSymbolKinds();
      expect(kinds).toContain('Class');
      expect(kinds).toContain('Method');
      expect(kinds).toContain('Interface');
      expect(kinds).toContain('Field');
      expect(kinds).toContain('Enum');
    });
  });

  describe('getSymbolKindDisplay', () => {
    it('应该返回数字和标签', () => {
      const display = getSymbolKindDisplay(5);
      expect(display.value).toBe(5);
      expect(display.label).toBe('Class');
    });

    it('应该处理无效编号', () => {
      const display = getSymbolKindDisplay(999);
      expect(display.value).toBe(999);
      expect(display.label).toBe('Unknown(999)');
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

    it('stringToSymbolKind 大小写规范化后应能往返转换', () => {
      // 验证 'class' -> 5 -> 'Class' 的往返
      const num = stringToSymbolKind('class');
      expect(num).toBe(5);
      const back = symbolKindToString(num!);
      expect(back).toBe('Class'); // 注意: 返回的是标准形式，不是原始输入
    });
  });
});
