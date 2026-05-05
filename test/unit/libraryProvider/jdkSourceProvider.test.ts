/**
 * jdkSourceProvider 单元测试
 *
 * 只验证核心定位逻辑 `locateClassInSrcZip`：
 *   - JDK 8 平铺：java/util/List.java
 *   - JDK 9+ 模块化：java.base/java/util/List.java
 *
 * 对 `fetch` 的完整 I/O 流程（需要真实 JAVA_HOME + src.zip + 写磁盘）不在单测范围内，
 * 由 SP06 的 E2E 手动验证覆盖。
 *
 * 参见 SP01 Task 1.11
 */

import { ZipReader } from '../../../src/libraryProvider/platform/zipReader';
import { locateClassInSrcZip } from '../../../src/libraryProvider/sources/jdkSourceProvider';

/**
 * 构造最小有效 ZIP（STORED 压缩）供测试使用。
 * 结构：LocalFileHeader 序列 + CentralDirectoryHeader 序列 + EndOfCentralDirectory。
 */
function buildMinimalZip(entries: Array<{ name: string; content: string }>): Buffer {
  const parts: Buffer[] = [];
  const cdrParts: Buffer[] = [];
  let offset = 0;
  const records: Array<{
    name: Buffer;
    crc: number;
    size: number;
    localOffset: number;
  }> = [];

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.content, 'utf8');
    const crc = crc32Fallback(data);
    const localOffset = offset;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4);          // version needed
    lfh.writeUInt16LE(0, 6);           // flags
    lfh.writeUInt16LE(0, 8);           // method=STORED
    lfh.writeUInt16LE(0, 10);          // mtime
    lfh.writeUInt16LE(0, 12);          // mdate
    lfh.writeUInt32LE(crc, 14);        // crc32
    lfh.writeUInt32LE(data.length, 18); // compressed size
    lfh.writeUInt32LE(data.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);          // extra len
    parts.push(lfh, nameBuf, data);

    records.push({ name: nameBuf, crc, size: data.length, localOffset });
    offset += 30 + nameBuf.length + data.length;
  }

  const cdrStart = offset;
  for (const r of records) {
    const cdr = Buffer.alloc(46);
    cdr.writeUInt32LE(0x02014b50, 0);
    cdr.writeUInt16LE(20, 4);   // version made by
    cdr.writeUInt16LE(20, 6);   // version needed
    cdr.writeUInt16LE(0, 8);    // flags
    cdr.writeUInt16LE(0, 10);   // method
    cdr.writeUInt16LE(0, 12);   // mtime
    cdr.writeUInt16LE(0, 14);   // mdate
    cdr.writeUInt32LE(r.crc, 16);
    cdr.writeUInt32LE(r.size, 20);
    cdr.writeUInt32LE(r.size, 24);
    cdr.writeUInt16LE(r.name.length, 28);
    cdr.writeUInt16LE(0, 30);
    cdr.writeUInt16LE(0, 32);
    cdr.writeUInt16LE(0, 34);
    cdr.writeUInt16LE(0, 36);
    cdr.writeUInt32LE(0, 38);
    cdr.writeUInt32LE(r.localOffset, 42);
    cdrParts.push(cdr, r.name);
    offset += 46 + r.name.length;
  }

  const cdrSize = offset - cdrStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                  // disk no
  eocd.writeUInt16LE(0, 6);                  // cd start disk
  eocd.writeUInt16LE(records.length, 8);     // entries on this disk
  eocd.writeUInt16LE(records.length, 10);    // total entries
  eocd.writeUInt32LE(cdrSize, 12);
  eocd.writeUInt32LE(cdrStart, 16);
  eocd.writeUInt16LE(0, 20);                 // comment len

  return Buffer.concat([...parts, ...cdrParts, eocd]);
}

/**
 * Node 某些旧版本 zlib 无 crc32。提供最小 fallback 保证测试可运行。
 */
function crc32Fallback(buf: Buffer): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe('locateClassInSrcZip', () => {
  it('JDK 8 平铺布局：java/util/List.java 命中', () => {
    const data = buildMinimalZip([
      { name: 'java/util/List.java', content: 'package java.util; public interface List {}' },
      { name: 'java/lang/String.java', content: 'package java.lang; public class String {}' },
    ]);
    const zip = new ZipReader(data);
    const located = locateClassInSrcZip(zip, 'java.util.List');
    expect(located).toEqual({ entryName: 'java/util/List.java', module: 'default' });
  });

  it('JDK 9+ 模块化布局：java.base/java/util/List.java 命中', () => {
    const data = buildMinimalZip([
      { name: 'java.base/java/util/List.java', content: 'package java.util; public interface List {}' },
      { name: 'java.base/java/lang/String.java', content: 'package java.lang; public class String {}' },
      { name: 'java.sql/java/sql/Connection.java', content: 'package java.sql; public interface Connection {}' },
    ]);
    const zip = new ZipReader(data);
    const located = locateClassInSrcZip(zip, 'java.util.List');
    expect(located).toEqual({ entryName: 'java.base/java/util/List.java', module: 'java.base' });

    const sql = locateClassInSrcZip(zip, 'java.sql.Connection');
    expect(sql).toEqual({ entryName: 'java.sql/java/sql/Connection.java', module: 'java.sql' });
  });

  it('类不存在返回 null', () => {
    const data = buildMinimalZip([
      { name: 'java.base/java/lang/String.java', content: 'x' },
    ]);
    const zip = new ZipReader(data);
    expect(locateClassInSrcZip(zip, 'java.util.NonExistent')).toBeNull();
  });

  it('ZipReader 能读取顶层目录名', () => {
    const data = buildMinimalZip([
      { name: 'java.base/java/lang/String.java', content: 'x' },
      { name: 'java.desktop/javax/swing/JFrame.java', content: 'y' },
    ]);
    const zip = new ZipReader(data);
    const tops = zip.listTopLevelDirs().sort();
    expect(tops).toEqual(['java.base', 'java.desktop']);
  });

  it('ZipReader.readText 能还原 STORED 内容', () => {
    const original = 'package java.util; public interface List {}';
    const data = buildMinimalZip([
      { name: 'java/util/List.java', content: original },
    ]);
    const zip = new ZipReader(data);
    expect(zip.readText('java/util/List.java')).toBe(original);
  });
});
