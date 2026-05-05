/**
 * jdkRuntimeDetector 单元测试
 *
 * 覆盖：container / fqcn / 空输入 / 模块推断
 * 参见 SP01 Task 1.11
 */

import {
  isJdkContainer,
  isJdkFqcn,
  isJdk,
  inferJdkModule,
} from '../../../src/libraryProvider/resolvers/jdkRuntimeDetector';

describe('isJdkContainer', () => {
  it('空字符串返回 false', () => {
    expect(isJdkContainer('')).toBe(false);
  });

  it('jrt-fs.jar 命中', () => {
    expect(isJdkContainer('/usr/lib/jvm/java-17/lib/jrt-fs.jar')).toBe(true);
  });

  it('.jmod 命中', () => {
    expect(isJdkContainer('/usr/lib/jvm/java-11/jmods/java.base.jmod')).toBe(true);
  });

  it('/jre/lib/ 路径命中', () => {
    expect(isJdkContainer('/opt/java/jre/lib/rt.jar')).toBe(true);
  });

  it('Windows /jmods/ 路径命中', () => {
    expect(isJdkContainer('C:\\Program Files\\Java\\jdk-17\\jmods\\java.sql.jmod')).toBe(true);
  });

  it('模块名形式 java.base 命中', () => {
    expect(isJdkContainer('java.base')).toBe(true);
    expect(isJdkContainer('jdk.compiler')).toBe(true);
  });

  it('三方 jar 不命中', () => {
    expect(isJdkContainer('/home/u/.m2/repository/org/mybatis/mybatis/3.5.16/mybatis-3.5.16.jar')).toBe(false);
  });
});

describe('isJdkFqcn', () => {
  it('java.util.List 命中', () => {
    expect(isJdkFqcn('java.util.List')).toBe(true);
  });

  it('javax.* 命中', () => {
    expect(isJdkFqcn('javax.annotation.Nullable')).toBe(true);
  });

  it('jdk.* 命中', () => {
    expect(isJdkFqcn('jdk.internal.misc.Unsafe')).toBe(true);
  });

  it('com.sun.* / sun.* 命中', () => {
    expect(isJdkFqcn('com.sun.management.OperatingSystemMXBean')).toBe(true);
    expect(isJdkFqcn('sun.nio.ch.SelectorImpl')).toBe(true);
  });

  it('三方类不命中', () => {
    expect(isJdkFqcn('com.mybatis.Foo')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isJdkFqcn('')).toBe(false);
  });
});

describe('isJdk (组合)', () => {
  it('container 或 fqcn 命中任一即为 true', () => {
    expect(isJdk('some/thirdparty.jar', 'java.util.List')).toBe(true);
    expect(isJdk('/jmods/java.base.jmod', 'com.mybatis.Foo')).toBe(true);
    expect(isJdk('thirdparty.jar', 'com.mybatis.Foo')).toBe(false);
  });
});

describe('inferJdkModule', () => {
  it('java.lang.* → java.base', () => {
    expect(inferJdkModule('java.lang.String')).toBe('java.base');
  });

  it('java.util.* → java.base', () => {
    expect(inferJdkModule('java.util.List')).toBe('java.base');
  });

  it('java.sql.* → java.sql', () => {
    expect(inferJdkModule('java.sql.Connection')).toBe('java.sql');
  });

  it('javax.swing.* → java.desktop', () => {
    expect(inferJdkModule('javax.swing.JFrame')).toBe('java.desktop');
  });

  it('javax.xml.* → java.xml', () => {
    expect(inferJdkModule('javax.xml.parsers.DocumentBuilder')).toBe('java.xml');
  });

  it('未知命名空间返回 null', () => {
    expect(inferJdkModule('com.mybatis.Foo')).toBeNull();
  });

  it('空输入返回 null', () => {
    expect(inferJdkModule('')).toBeNull();
  });
});
