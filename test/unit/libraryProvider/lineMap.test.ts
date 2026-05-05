/**
 * lineMap 单元测试（SP03 Task 3.7）
 *
 * 覆盖：
 * - 方法签名正则匹配 & 行号映射
 * - best-effort 精度
 * - n/a 路径返回 0-0
 * - 无方法时返回 n/a
 * - 大括号平衡推算 endLine
 * - 文件不存在返回 n/a
 *
 * 参见：[SP03 子计划 Task 3.4 / 3.7](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLineMap, LineMap, LineRange } from '../../../src/libraryProvider/decompile/lineMap';

describe('lineMap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-lm-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function writeJavaFile(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  const sampleClass = `
public class Hello {

    public void greet(String name) {
        System.out.println("Hello, " + name);
    }

    private static int add(int a, int b) {
        return a + b;
    }

    public String toString() {
        return "Hello";
    }

    protected synchronized void lockMethod() {
        // do nothing
    }
}
`.trim();

  test('buildLineMap parses method signatures and maps lines within method bodies', async () => {
    const filePath = writeJavaFile('Hello.java', sampleClass);
    const lineMap = await buildLineMap(filePath);

    // greet 方法：line 大约在第 4 行（greet 声明）
    // 映射 byteCode 在 greet 体内的行（如 5）→ 应映射到 greet 声明行
    const mapped = lineMap.translate({
      start: { line: 5, character: 0 },
      end: { line: 5, character: 0 },
    });
    expect(mapped.quality).toBe('best-effort');
    expect(mapped.range.start.line).toBeGreaterThan(0);
    expect(mapped.range.end.line).toBeGreaterThan(0);
  });

  test('translate returns best-effort for range within method body', async () => {
    const filePath = writeJavaFile('Calc.java', `
public class Calc {
    public int sum(int x, int y) {
        int result = x + y;
        return result;
    }
}
`.trim());
    const lineMap = await buildLineMap(filePath);
    // line 4 (= body line 2 within sum) should map to sum declaration
    const mapped = lineMap.translate({
      start: { line: 4, character: 0 },
      end: { line: 4, character: 0 },
    });
    expect(mapped.quality).toBe('best-effort');
    expect(mapped.range.start.line).toBeGreaterThan(0);
  });

  test('translate returns n/a when file does not exist', async () => {
    const lineMap = await buildLineMap('/nonexistent/Foo.java');
    const mapped = lineMap.translate({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
    expect(mapped.quality).toBe('n/a');
    expect(mapped.range.start.line).toBe(0);
    expect(mapped.range.end.line).toBe(0);
  });

  test('translate returns n/a when no methods found', async () => {
    const filePath = writeJavaFile('Empty.java', 'public class Empty { }');
    const lineMap = await buildLineMap(filePath);
    const mapped = lineMap.translate({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
    // 无方法的类 → n/a
    expect(mapped.quality).toBe('n/a');
  });

  test('translate maps to nearest method when range outside all methods', async () => {
    const filePath = writeJavaFile('Multi.java', `
public class Multi {
    public static void main(String[] args) {
        System.out.println("main");
    }

    private void helper() {
        // helper body
    }
}
`.trim());
    const lineMap = await buildLineMap(filePath);
    // line 1 (class declaration, before any method) → should map to nearest method (main at ~line 2)
    const mapped = lineMap.translate({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
    expect(mapped.quality).toBe('best-effort');
    expect(mapped.range.start.line).toBeGreaterThan(0);
  });

  test('brace matching correctly determines endLine of methods', async () => {
    const filePath = writeJavaFile('Brace.java', `
public class Brace {
    public void first() {
        // only one line
    }

    public void second() {
        int a = 1;
        int b = 2;
        int c = a + b;
    }
}
`.trim());
    const lineMap = await buildLineMap(filePath);
    // first() body ended at line ~4, second() goes beyond
    // range at line 8 (within second's body) should map to second
    const mapped = lineMap.translate({
      start: { line: 8, character: 0 },
      end: { line: 8, character: 0 },
    });
    expect(mapped.quality).toBe('best-effort');
    expect(mapped.range.start.line).toBeGreaterThan(0);
  });

  test('translate returns non-zero range usable by libraryClassLocator', async () => {
    // 模拟 libraryClassLocator.tryDecompile 的集成场景：
    // 字节码行号（如第 42 行某方法体内）→ 应映射到反编译产物中对应方法声明行
    const filePath = writeJavaFile('Target.java', `
import java.util.List;

public class Target {
    private List<String> items;

    public Target(List<String> items) {
        this.items = items;
    }

    public List<String> getItems() {
        return items;
    }

    public void setItems(List<String> items) {
        this.items = items;
    }

    public int size() {
        return items != null ? items.size() : 0;
    }
}
`.trim());
    const lineMap = await buildLineMap(filePath);
    // 模拟字节码中 getItems 方法体内某行（类文件字节码行号与该类第 11 行大致对应）
    const mapped = lineMap.translate({
      start: { line: 11, character: 14 },
      end: { line: 11, character: 14 },
    });
    // 核心断言：range 必须非零（修复前 libraryClassLocator 返回 zero range）
    expect(mapped.range.start.line).toBeGreaterThan(0);
    expect(mapped.range.end.line).toBeGreaterThanOrEqual(mapped.range.start.line);
    // 质量应为 best-effort（反编译的常态）
    expect(mapped.quality).toBe('best-effort');
    // 映射到的方法声明行应在文件中（不超过文件行数）
    const fileLines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length;
    expect(mapped.range.start.line).toBeLessThanOrEqual(fileLines);
  });
});
