/**
 * jdtUriParser 单元测试
 *
 * 覆盖：jdt://contents / jdt://jarentry / file:// / 畸形 URI
 * 参见 SP01 Task 1.11
 */

import { parse } from '../../../src/libraryProvider/core/jdtUriParser';

describe('jdtUriParser.parse', () => {
  describe('非 jdt:// URI', () => {
    it('空字符串返回 null', () => {
      expect(parse('')).toBeNull();
    });

    it('file:// URI 返回 null', () => {
      expect(parse('file:///tmp/Foo.java')).toBeNull();
    });

    it('非字符串输入返回 null', () => {
      // @ts-expect-error 故意传入非字符串
      expect(parse(null)).toBeNull();
      // @ts-expect-error 故意传入非字符串
      expect(parse(undefined)).toBeNull();
    });
  });

  describe('jdt://contents/', () => {
    it('解析 JDK 类 jdt://contents/java.base/java/util/List.class?=foo', () => {
      const parsed = parse('jdt://contents/java.base/java/util/List.class?=abc');
      expect(parsed).toEqual({ container: 'java.base', fqcn: 'java.util.List' });
    });

    it('解析三方库 jdt://contents/mybatis.../com/mybatis/Foo.class', () => {
      const parsed = parse('jdt://contents/mybatis-3/com/mybatis/Foo.class?=x');
      expect(parsed).toEqual({ container: 'mybatis-3', fqcn: 'com.mybatis.Foo' });
    });

    it('无 query 也能解析', () => {
      const parsed = parse('jdt://contents/java.base/java/lang/String.class');
      expect(parsed).toEqual({ container: 'java.base', fqcn: 'java.lang.String' });
    });

    it('URI 编码能正确还原', () => {
      const encoded = 'jdt://contents/java.base/java/util/Map%24Entry.class?=h';
      const parsed = parse(encoded);
      expect(parsed).toEqual({ container: 'java.base', fqcn: 'java.util.Map$Entry' });
    });

    it('没有 .class 后缀返回 null', () => {
      expect(parse('jdt://contents/java.base/java/util/List?=h')).toBeNull();
    });

    it('段数不足返回 null', () => {
      expect(parse('jdt://contents/Foo.class?=h')).toBeNull();
    });
  });

  describe('jdt://jarentry/', () => {
    it('解析 jdt://jarentry/<jar>!/<pkg>/<Class>.class', () => {
      const parsed = parse('jdt://jarentry//tmp/foo.jar!/com/acme/Bar.class');
      expect(parsed).toEqual({ container: '/tmp/foo.jar', fqcn: 'com.acme.Bar' });
    });

    it('缺少 !/ 返回 null', () => {
      expect(parse('jdt://jarentry//tmp/foo.jar/com/acme/Bar.class')).toBeNull();
    });

    it('无 .class 后缀返回 null', () => {
      expect(parse('jdt://jarentry//tmp/foo.jar!/com/acme/Bar')).toBeNull();
    });
  });

  describe('畸形 URI 的防御性处理', () => {
    it('只有协议头返回 null', () => {
      expect(parse('jdt://contents/')).toBeNull();
    });

    it('带非法百分号编码降级为原字符串（不抛异常）', () => {
      // %ZZ 非法，decodeURIComponent 抛错；我们的 safe 版本应退化为原串
      const uri = 'jdt://contents/java.base/java/util/Ma%ZZ.class';
      expect(() => parse(uri)).not.toThrow();
    });
  });
});
