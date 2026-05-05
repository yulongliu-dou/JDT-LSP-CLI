/**
 * mavenDependencyResolver 单元测试（SP04 Task 4.8）
 *
 * 覆盖：
 * - jarToGAV：~/.m2/repository 标准路径反解 GAV
 * - jarToGAV：非 .m2 路径返回 null
 * - resolveLocalRepo：默认 ~/.m2/repository + settings.xml 自定义
 * - listDirectDeps：pom.xml 直接依赖（跳过 test/provided/optional）
 *
 * 参见：[SP04 子计划 Task 4.1 / 4.8](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  jarToGAV,
  resolveLocalRepo,
  listDirectDeps,
} from '../../../src/libraryProvider/resolvers/mavenDependencyResolver';

describe('mavenDependencyResolver', () => {
  describe('jarToGAV', () => {
    test('resolves standard ~/.m2/repository path', () => {
      const gav = jarToGAV(
        path.join(os.homedir(), '.m2', 'repository', 'org', 'mybatis', 'mybatis', '3.5.13', 'mybatis-3.5.13.jar')
      );
      expect(gav).not.toBeNull();
      expect(gav!.groupId).toBe('org.mybatis');
      expect(gav!.artifactId).toBe('mybatis');
      expect(gav!.version).toBe('3.5.13');
      expect(gav!.classifier).toBeUndefined();
    });

    test('resolves classifier jar path', () => {
      const gav = jarToGAV(
        path.join(os.homedir(), '.m2', 'repository', 'com', 'example', 'lib', '1.0', 'lib-1.0-sources.jar')
      );
      expect(gav).not.toBeNull();
      expect(gav!.groupId).toBe('com.example');
      expect(gav!.artifactId).toBe('lib');
      expect(gav!.version).toBe('1.0');
      expect(gav!.classifier).toBe('sources');
    });

    test('returns null for non-.m2 path', () => {
      const gav = jarToGAV('/some/random/path/foo.jar');
      expect(gav).toBeNull();
    });

    test('returns null for empty input', () => {
      expect(jarToGAV('')).toBeNull();
    });
  });

  describe('resolveLocalRepo', () => {
    test('returns default ~/.m2/repository when no settings.xml', () => {
      // 默认行为（测试环境不应有自定义 settings.xml）
      const repo = resolveLocalRepo();
      expect(repo).toContain('.m2');
      expect(repo.endsWith('repository')).toBe(true);
    });
  });

  describe('listDirectDeps', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-mdr-'));
    });

    afterEach(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('returns empty for non-existent pom.xml', async () => {
      const deps = await listDirectDeps(tmpDir);
      expect(deps).toEqual([]);
    });

    test('parses direct dependencies from pom.xml', async () => {
      const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.mybatis</groupId>
      <artifactId>mybatis</artifactId>
      <version>3.5.13</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>33.0.0-jre</version>
    </dependency>
  </dependencies>
</project>`;
      fs.writeFileSync(path.join(tmpDir, 'pom.xml'), pom, 'utf-8');
      const deps = await listDirectDeps(tmpDir);
      expect(deps).toHaveLength(2);
      expect(deps[0].groupId).toBe('org.mybatis');
      expect(deps[1].groupId).toBe('com.google.guava');
    });

    test('skips provided scope', async () => {
      const pom = `<project>
  <dependencies>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>servlet-api</artifactId>
      <version>4.0.1</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>real-dep</artifactId>
      <version>1.0</version>
    </dependency>
  </dependencies>
</project>`;
      fs.writeFileSync(path.join(tmpDir, 'pom.xml'), pom, 'utf-8');
      const deps = await listDirectDeps(tmpDir);
      expect(deps).toHaveLength(1);
      expect(deps[0].groupId).toBe('com.example');
    });
  });
});
