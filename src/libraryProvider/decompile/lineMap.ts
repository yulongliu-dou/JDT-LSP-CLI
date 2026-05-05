/**
 * 反编译产物 ↔ 字节码行号映射（尽力而为）
 *
 * 策略：
 * - 解析反编译产物，按方法名 + 形参类型定位方法声明行
 * - 字节码 `range` 若在方法范围内，映射到方法声明行，`quality: 'best-effort'`
 * - 无法匹配时返回 `{ range: { start: 0, end: 0 }, quality: 'n/a' }`
 *
 * 参见：[SP03 子计划 Task 3.4](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md)
 */

import * as fs from 'fs';

/** 简化的范围描述（行号 1-based，列 1-based） */
export interface LineRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** 行号映射结果 */
export interface MappedRange {
  range: LineRange;
  quality: 'best-effort' | 'exact' | 'n/a';
}

/**
 * 行号映射器
 */
export interface LineMap {
  /**
   * 将字节码 range 映射到反编译产物行号
   *
   * @param byteCodeRange 原始 range（来自 JDT LS 的字节码行号）
   * @returns 映射后的 range + 精度标记
   */
  translate(byteCodeRange: LineRange): MappedRange;
}

/**
 * 方法签名条目
 */
interface MethodEntry {
  /** 方法名 */
  name: string;
  /** 方法声明的行号（1-based） */
  line: number;
  /** 方法体起始行号（可估计为 line+1） */
  bodyStartLine: number;
  /** 方法结束行号 */
  endLine: number;
}

/**
 * 从反编译 Java 源码中正则抽取方法声明位置
 *
 * 匹配模式：
 *   public|protected|private  [static]  [<generic>]  <returnType>  <methodName> (
 *
 * 返回按行号排序的方法条目数组。
 */
function extractMethodEntries(source: string): MethodEntry[] {
  const lines = source.split(/\r?\n/);
  const entries: MethodEntry[] = [];

  // 方法声明正则：访问修饰符 + 可选 static/final/synchronized + 返回类型 + 方法名 + (
  // 排除构造函数（与类名同名）较难，保留由调用方判断
  const methodRegex = /^\s*(?:(?:public|protected|private)\s+)?(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[\w\s,?]+>\s+)?[\w<>[\],\s]+\s+(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = methodRegex.exec(line);
    if (!m) continue;
    const name = m[1];
    // 排除关键字命名的"方法"（如 if/for/while 误匹配）
    if (/^(if|for|while|switch|return|throw|catch|finally|synchronized|class|interface|enum|new|try|do|else|case|default|break|continue)$/.test(name)) {
      continue;
    }
    entries.push({
      name,
      line: i + 1,
      bodyStartLine: i + 2,
      endLine: i + 2, // 暂占位，后续由大括号平衡推算
    });
  }

  // 推算 endLine：使用大括号平衡
  const braceStack: number[] = [];
  const methodStack: MethodEntry[] = [];
  let methodIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // 当到达一个方法声明行时，入栈
    while (methodIdx < entries.length && entries[methodIdx].line === lineNum) {
      methodStack.push(entries[methodIdx]);
      methodIdx++;
    }

    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '{') {
        braceStack.push(lineNum);
      } else if (ch === '}') {
        braceStack.pop();
        // 若大括号栈回退到方法入栈时的深度，说明该方法体结束
        if (methodStack.length > 0 && braceStack.length <= methodStack.length - 1) {
          const entry = methodStack.pop()!;
          entry.endLine = lineNum;
        }
      }
    }
  }

  // 未闭合的方法：用文件末尾行作为 endLine
  const lastLine = lines.length;
  for (const entry of methodStack) {
    entry.endLine = lastLine;
  }

  return entries;
}

/**
 * 构建反编译产物的行号映射器
 *
 * @param javaFilePath 反编译产物的 .java 文件路径
 * @returns LineMap；文件不存在/读失败时返回全 n/a 的映射器
 */
export async function buildLineMap(javaFilePath: string): Promise<LineMap> {
  let source: string;
  try {
    source = fs.readFileSync(javaFilePath, 'utf-8');
  } catch {
    return noOpLineMap;
  }

  const entries = extractMethodEntries(source);

  // 按行号排序
  entries.sort((a, b) => a.line - b.line);

  return {
    translate(byteCodeRange: LineRange): MappedRange {
      const targetLine = byteCodeRange.start.line;

      // 在方法条目中查找包含 targetLine 的方法
      let best: MethodEntry | null = null;
      for (const entry of entries) {
        if (entry.bodyStartLine <= targetLine && targetLine <= entry.endLine) {
          best = entry;
          break; // 第一个匹配即可（行号排序保证）
        }
      }

      // 若未能精确匹配，找最近的方法声明
      if (!best) {
        let closest: MethodEntry | null = null;
        let minDist = Infinity;
        for (const entry of entries) {
          const dist = Math.abs(entry.line - targetLine);
          if (dist < minDist) {
            minDist = dist;
            closest = entry;
          }
        }
        if (!closest) {
          return { range: zeroRange, quality: 'n/a' };
        }
        return {
          range: {
            start: { line: closest.line, character: 0 },
            end: { line: closest.line, character: 0 },
          },
          quality: 'best-effort',
        };
      }

      return {
        range: {
          start: { line: best.line, character: 0 },
          end: { line: best.line, character: 0 },
        },
        quality: 'best-effort',
      };
    },
  };
}

const zeroRange: LineRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

const noOpLineMap: LineMap = {
  translate: () => ({ range: zeroRange, quality: 'n/a' }),
};
