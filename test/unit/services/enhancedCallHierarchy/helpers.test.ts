/**
 * 增强调用链 helpers 单元测试
 */

import { generateMethodId } from '../../../../src/services/enhancedCallHierarchy/core/helpers';

describe('enhancedCallHierarchy helpers', () => {
  describe('generateMethodId', () => {
    it('应该基于 URI 和方法名生成唯一ID', () => {
      const uri = 'file:///path/to/MyClass.java';
      const methodName = 'myMethod';
      const line = 10;
      
      const id = generateMethodId(uri, methodName, line);
      
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('应该为相同输入生成相同ID', () => {
      const uri = 'file:///path/to/MyClass.java';
      const methodName = 'myMethod';
      const line = 10;
      
      const id1 = generateMethodId(uri, methodName, line);
      const id2 = generateMethodId(uri, methodName, line);
      
      expect(id1).toBe(id2);
    });

    it('应该为不同行号生成不同ID', () => {
      const uri = 'file:///path/to/MyClass.java';
      const methodName = 'myMethod';
      
      const id1 = generateMethodId(uri, methodName, 10);
      const id2 = generateMethodId(uri, methodName, 20);
      
      expect(id1).not.toBe(id2);
    });

    it('应该为不同方法名生成不同ID', () => {
      const uri = 'file:///path/to/MyClass.java';
      
      const id1 = generateMethodId(uri, 'method1', 10);
      const id2 = generateMethodId(uri, 'method2', 10);
      
      expect(id1).not.toBe(id2);
    });

    it('应该为不同URI生成不同ID', () => {
      const methodName = 'myMethod';
      const line = 10;
      
      const id1 = generateMethodId('file:///path/MyClass1.java', methodName, line);
      const id2 = generateMethodId('file:///path/MyClass2.java', methodName, line);
      
      expect(id1).not.toBe(id2);
    });

    it('应该处理特殊字符', () => {
      const uri = 'file:///path/to/My-Class.java';
      const methodName = 'my_method';
      const line = 10;
      
      const id = generateMethodId(uri, methodName, line);
      expect(id).toBeDefined();
    });

    it('应该处理中文路径', () => {
      const uri = 'file:///路径/类.java';
      const methodName = '方法';
      const line = 10;
      
      const id = generateMethodId(uri, methodName, line);
      expect(id).toBeDefined();
    });
  });
});
