/**
 * 最小 ZIP 读取器
 *
 * 仅支持本模块所需最小功能集：
 * - 解析 End of Central Directory (EOCD) 与 Central Directory
 * - 提取指定 entry 名的内容（支持 STORE / DEFLATE）
 * - 列出顶层目录名（用于 sniff JDK 8 平铺 vs 9+ 模块化布局）
 *
 * 不依赖任何 npm 包，仅用 Node 原生 `fs` + `zlib`。
 * 参见 ZIP 规范：PKWARE APPNOTE.TXT 4.5.x。
 *
 * 参见：[SP01 子计划 Task 1.5](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import * as fs from 'fs';
import * as zlib from 'zlib';

/** ZIP 压缩方式 */
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** EOCD 签名 0x06054b50 / CDR 签名 0x02014b50 / Local 签名 0x04034b50 */
const SIG_EOCD = 0x06054b50;
const SIG_CDR = 0x02014b50;
const SIG_LFH = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipReader {
  private buf: Buffer;
  private entries: Map<string, ZipEntry> | null = null;

  constructor(data: Buffer) {
    this.buf = data;
  }

  static fromFile(filePath: string): ZipReader {
    const data = fs.readFileSync(filePath);
    return new ZipReader(data);
  }

  /**
   * 列出所有 entry
   */
  list(): ZipEntry[] {
    this.ensureIndexed();
    return Array.from(this.entries!.values());
  }

  /**
   * 按名称获取 entry
   */
  find(name: string): ZipEntry | undefined {
    this.ensureIndexed();
    return this.entries!.get(name);
  }

  /**
   * 判断是否存在 entry
   */
  has(name: string): boolean {
    return this.find(name) !== undefined;
  }

  /**
   * 读取 entry 内容（UTF-8 解码）
   */
  readText(name: string): string | null {
    const buf = this.readBuffer(name);
    return buf ? buf.toString('utf8') : null;
  }

  /**
   * 读取 entry 内容（原始 Buffer）
   */
  readBuffer(name: string): Buffer | null {
    this.ensureIndexed();
    const entry = this.entries!.get(name);
    if (!entry) return null;
    return this.extract(entry);
  }

  /**
   * 返回顶层目录名去重列表（不含末尾 /）。
   * 用于 sniff JDK 布局：
   * - JDK 8 src.zip：顶层为包名（java / javax / ...）
   * - JDK 9+ src.zip：顶层为模块名（java.base / java.desktop / ...）
   */
  listTopLevelDirs(): string[] {
    this.ensureIndexed();
    const set = new Set<string>();
    for (const name of this.entries!.keys()) {
      const slash = name.indexOf('/');
      if (slash > 0) {
        set.add(name.slice(0, slash));
      }
    }
    return Array.from(set);
  }

  // ---------- 内部 ----------

  private ensureIndexed(): void {
    if (this.entries) return;
    this.entries = new Map<string, ZipEntry>();
    const eocdOffset = this.findEOCD();
    if (eocdOffset < 0) {
      throw new Error('ZIP: EOCD not found (not a valid zip?)');
    }
    const cdrSize = this.buf.readUInt32LE(eocdOffset + 12);
    const cdrOffset = this.buf.readUInt32LE(eocdOffset + 16);
    const totalEntries = this.buf.readUInt16LE(eocdOffset + 10);

    let cursor = cdrOffset;
    const end = cdrOffset + cdrSize;
    for (let i = 0; i < totalEntries && cursor < end; i++) {
      const sig = this.buf.readUInt32LE(cursor);
      if (sig !== SIG_CDR) {
        throw new Error(`ZIP: bad CDR signature at ${cursor}`);
      }
      const method = this.buf.readUInt16LE(cursor + 10);
      const compressedSize = this.buf.readUInt32LE(cursor + 20);
      const uncompressedSize = this.buf.readUInt32LE(cursor + 24);
      const nameLen = this.buf.readUInt16LE(cursor + 28);
      const extraLen = this.buf.readUInt16LE(cursor + 30);
      const commentLen = this.buf.readUInt16LE(cursor + 32);
      const localOffset = this.buf.readUInt32LE(cursor + 42);
      const name = this.buf.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');

      if (!name.endsWith('/')) {
        // 只记录非目录 entry（目录可通过前缀推断）
        this.entries.set(name, {
          name,
          method,
          compressedSize,
          uncompressedSize,
          localHeaderOffset: localOffset,
        });
      } else {
        this.entries.set(name, {
          name,
          method,
          compressedSize: 0,
          uncompressedSize: 0,
          localHeaderOffset: localOffset,
        });
      }
      cursor += 46 + nameLen + extraLen + commentLen;
    }
  }

  /**
   * 从文件末尾向前搜索 EOCD 签名
   */
  private findEOCD(): number {
    const minEOCDSize = 22;
    const maxCommentSize = 0xffff;
    const start = Math.max(0, this.buf.length - (maxCommentSize + minEOCDSize));
    for (let i = this.buf.length - minEOCDSize; i >= start; i--) {
      if (this.buf.readUInt32LE(i) === SIG_EOCD) {
        return i;
      }
    }
    return -1;
  }

  private extract(entry: ZipEntry): Buffer {
    const lfhOffset = entry.localHeaderOffset;
    const sig = this.buf.readUInt32LE(lfhOffset);
    if (sig !== SIG_LFH) {
      throw new Error(`ZIP: bad LFH signature at ${lfhOffset}`);
    }
    const nameLen = this.buf.readUInt16LE(lfhOffset + 26);
    const extraLen = this.buf.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + nameLen + extraLen;
    const compressed = this.buf.slice(dataStart, dataStart + entry.compressedSize);

    if (entry.method === METHOD_STORED) {
      return Buffer.from(compressed);
    }
    if (entry.method === METHOD_DEFLATE) {
      return zlib.inflateRawSync(compressed);
    }
    throw new Error(`ZIP: unsupported compression method ${entry.method}`);
  }
}
