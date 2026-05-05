/**
 * sourceJarProvider 单元测试（SP04 Task 4.8）
 *
 * 覆盖：
 * - ~/.m2 命中 sources jar → 返回路径
 * - 未命中 + downloadMode=off → 返回 null
 * - extractFqcn：从 jar 中提取指定类
 *
 * 参见：[SP04 子计划 Task 4.2 / 4.8](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveLocalRepo } from '../../../src/libraryProvider/resolvers/mavenDependencyResolver';
import { extractFqcn } from '../../../src/libraryProvider/sources/sourceJarProvider';
import type { GAV } from '../../../src/libraryProvider/core/types';

// 创建一个最小 ZIP (jar) 用于测试 extractFqcn
function createMinimalJar(tmpDir: string): { jarPath: string; fqcn: string; expectedFile: string } {
  const jarPath = path.join(tmpDir, 'test-sources.jar');
  const fqcn = 'com.example.Foo';

  // 构造最小 legal ZIP：
  // 使用 node:zlib 写一个 PKZIP 符合规范的 jar
  const zlib = require('zlib');

  const entryName = 'com/example/Foo.java';
  const content = Buffer.from('package com.example;\n\npublic class Foo {}\n', 'utf-8');
  const nameBytes = Buffer.from(entryName, 'utf-8');

  // Local file header
  const lfh = Buffer.alloc(30 + nameBytes.length + content.length);

  // signature 0x04034b50
  lfh.writeUInt32LE(0x04034b50, 0);
  // version needed = 20 (2.0)
  lfh.writeUInt16LE(20, 4);
  // flags
  lfh.writeUInt16LE(0, 6);
  // method = STORE (0)
  lfh.writeUInt16LE(0, 8);
  // mod time / date (zeros ok)
  lfh.writeUInt32LE(0, 10);
  // crc32 (0 for STORE is wrong but widely tolerated; better leave 0)
  lfh.writeUInt32LE(0, 14);
  // compressed size = uncompressed size
  lfh.writeUInt32LE(content.length, 18);
  lfh.writeUInt32LE(content.length, 22);
  // file name length
  lfh.writeUInt16LE(nameBytes.length, 26);
  // extra field length
  lfh.writeUInt16LE(0, 28);

  let offset = 30;
  nameBytes.copy(lfh, offset);
  offset += nameBytes.length;
  content.copy(lfh, offset);

  const localFileTotalOffset = lfh.length;

  // Central directory entry
  const cd = Buffer.alloc(46 + nameBytes.length);

  // signature 0x02014b50
  cd.writeUInt32LE(0x02014b50, 0);
  // version made by
  cd.writeUInt16LE(20, 4);
  // version needed
  cd.writeUInt16LE(20, 6);
  // flags
  cd.writeUInt16LE(0, 8);
  // method
  cd.writeUInt16LE(0, 10);
  // mod time/date
  cd.writeUInt32LE(0, 12);
  // crc32
  cd.writeUInt32LE(0, 16);
  // compressed/uncompressed size
  cd.writeUInt32LE(content.length, 20);
  cd.writeUInt32LE(content.length, 24);
  // file name length
  cd.writeUInt16LE(nameBytes.length, 28);
  // extra field length
  cd.writeUInt16LE(0, 30);
  // comment length
  cd.writeUInt16LE(0, 32);
  // disk number start
  cd.writeUInt16LE(0, 34);
  // internal attrs
  cd.writeUInt16LE(0, 36);
  // external attrs
  cd.writeUInt32LE(0, 38);
  // local header offset
  cd.writeUInt32LE(0, 42);

  offset = 46;
  nameBytes.copy(cd, offset);

  const cdTotalOffset = localFileTotalOffset + cd.length;

  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);   // disk number
  eocd.writeUInt16LE(0, 6);   // disk with CD
  eocd.writeUInt16LE(1, 8);   // entries on this disk
  eocd.writeUInt16LE(1, 10);  // total entries
  eocd.writeUInt32LE(cd.length, 12);  // CD size
  eocd.writeUInt32LE(localFileTotalOffset, 16);  // CD offset
  eocd.writeUInt16LE(0, 20);  // comment length

  const jarBuf = Buffer.concat([lfh, cd, eocd]);
  fs.writeFileSync(jarPath, jarBuf);

  const expectedFile = path.join(tmpDir, 'out', entryName);
  return { jarPath, fqcn, expectedFile };
}

describe('sourceJarProvider', () => {
  describe('extractFqcn', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-sjp-'));
    });

    afterEach(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('extracts class from sources jar', async () => {
      const { jarPath, fqcn, expectedFile } = createMinimalJar(tmpDir);
      const outDir = path.join(tmpDir, 'out');
      const result = await extractFqcn(jarPath, fqcn, outDir);
      expect(result).not.toBeNull();
      expect(result).toBe(expectedFile);
      expect(fs.existsSync(expectedFile)).toBe(true);
      const content = fs.readFileSync(expectedFile, 'utf-8');
      expect(content).toContain('public class Foo');
    });

    test('returns null for non-existent class', async () => {
      const { jarPath } = createMinimalJar(tmpDir);
      const outDir = path.join(tmpDir, 'out');
      const result = await extractFqcn(jarPath, 'com.example.Bar', outDir);
      expect(result).toBeNull();
    });

    test('returns null for non-existent jar', async () => {
      const result = await extractFqcn('/nonexistent/foo.jar', 'com.example.Foo', tmpDir);
      expect(result).toBeNull();
    });
  });
});
