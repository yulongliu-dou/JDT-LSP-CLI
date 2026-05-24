/**
 * 字段生命周期分析服务
 *
 * 为 refs --lifecycle 和 definition 增强提供字段级语义分析。
 * 函数式导出，无共享状态，可被 daemon route handler 和 CLI 直接复用。
 */

import * as fs from 'fs';
import { FieldAnnotation, AnnotationGroup, EnhancedReference, ReferenceContext, ReferenceImpact, Location, AccessType, ViaType, DocumentSymbol } from '../core/types';

function detectLombokAnnotations(sourceLines: string[], className: string): FieldAnnotation[] {
  const annotations: FieldAnnotation[] = [];
  const classDeclLine = sourceLines.findIndex(
    l => l.includes('class ' + className) || l.includes('enum ' + className)
  );

  if (classDeclLine >= 0) {
    for (let i = classDeclLine - 1; i >= 0 && i >= classDeclLine - 5; i--) {
      const line = sourceLines[i].trim();
      if (line.startsWith('@Data')) {
        annotations.push({ name: '@Data', attributes: {}, on: 'class', effect: 'generates getter/setter for all fields' });
        break;
      }
      if (line.startsWith('@Getter')) {
        annotations.push({ name: '@Getter', attributes: {}, on: 'class', effect: 'generates getter for all fields' });
      }
      if (line.startsWith('@Setter')) {
        annotations.push({ name: '@Setter', attributes: {}, on: 'class', effect: 'generates setter for all fields' });
      }
      if (!line.startsWith('@') && line !== '') break;
    }
  }
  return annotations;
}

function detectJsonAnnotations(fieldSourceLine: string, fieldName: string, className: string): FieldAnnotation[] {
  const annotations: FieldAnnotation[] = [];
  for (const pattern of [
    { regex: /@JsonProperty\s*\(\s*"([^"]+)"/, name: '@JsonProperty' },
    { regex: /@SerializedName\s*\(\s*"([^"]+)"/, name: '@SerializedName' },
    { regex: /@JsonAlias\s*\(\s*\{?\s*"([^"]+)"/, name: '@JsonAlias' },
  ]) {
    const m = fieldSourceLine.match(pattern.regex);
    if (m) {
      annotations.push({
        name: pattern.name,
        attributes: { value: m[1] },
        location: `${className}.${fieldName}`,
      });
    }
  }
  return annotations;
}

function detectDbAnnotations(fieldSourceLine: string, fieldName: string, className: string): FieldAnnotation[] {
  const annotations: FieldAnnotation[] = [];
  for (const pattern of [
    { regex: /@Column\s*\(\s*name\s*=\s*"([^"]+)"/, name: '@Column', attr: 'name' },
    { regex: /@TableField\s*\(\s*"([^"]+)"/, name: '@TableField', attr: 'name' },
    { regex: /@TableField\s*\(\s*value\s*=\s*"([^"]+)"/, name: '@TableField', attr: 'name' },
  ]) {
    const m = fieldSourceLine.match(pattern.regex);
    if (m) {
      annotations.push({
        name: pattern.name,
        attributes: { [pattern.attr]: m[1] },
        location: `${className}.${fieldName}`,
      });
    }
  }
  return annotations;
}

function detectTableAnnotation(sourceLines: string[], className: string): FieldAnnotation[] {
  for (const line of sourceLines) {
    const m = line.match(/@Table\s*\(\s*name\s*=\s*"([^"]+)"/);
    if (m) {
      return [{ name: '@Table', attributes: { name: m[1] }, on: 'class' }];
    }
  }
  return [];
}

export function extractAnnotations(
  sourceLines: string[],
  fieldSourceLine: string,
  fieldName: string,
  className: string
): AnnotationGroup {
  const annotations: AnnotationGroup = {};

  const lombok = detectLombokAnnotations(sourceLines, className);
  if (lombok.length) annotations.lombok = lombok;

  const json = detectJsonAnnotations(fieldSourceLine, fieldName, className);
  if (json.length) annotations.json = json;

  const dbTable = detectTableAnnotation(sourceLines, className);
  const dbCol = detectDbAnnotations(fieldSourceLine, fieldName, className);
  const db = [...dbTable, ...dbCol];
  if (db.length) annotations.db = db;

  return annotations;
}

// ========== 引用增强 ==========

export function readSourceLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return [];
  }
}

function readSourceLine(filePath: string, lineNumber: number): string {
  const lines = readSourceLines(filePath);
  return lines[lineNumber - 1]?.trim() || '';
}

function classifyAccessType(sourceLine: string): AccessType {
  const hasSetterPattern = /\.set\w+\s*\(/.test(sourceLine);
  const hasAssignment = /\b\w+\s*=\s*/.test(sourceLine) && !sourceLine.includes('==');
  const hasGetterPattern = /\.get\w+\s*\(\)/.test(sourceLine);
  const hasComparison = /[!=]=\s*\w+/.test(sourceLine);
  const hasReturn = /^return\b/.test(sourceLine.trim());

  const isWrite = hasSetterPattern || hasAssignment;
  const isRead = hasGetterPattern || hasComparison || hasReturn;

  if (isWrite && isRead) return 'readWrite';
  if (isWrite) return 'write';
  if (isRead) return 'read';
  return 'unknown';
}

function classifyVia(sourceLine: string, fieldName: string): ViaType {
  const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  if (new RegExp(`\\.set${capitalized}\\s*\\(`).test(sourceLine)) return 'setter';
  if (new RegExp(`\\.get${capitalized}\\s*\\(\\)`).test(sourceLine)) return 'getter';
  if (new RegExp(`\\.is${capitalized}\\s*\\(\\)`).test(sourceLine)) return 'getter';
  if (sourceLine.includes('.' + fieldName) && !sourceLine.includes('.' + fieldName + '(')) return 'direct';
  return 'unknown';
}

function findEnclosingMethod(symbols: DocumentSymbol[], line: number): string | null {
  for (const sym of symbols) {
    const startLine = sym.selectionRange.start.line;
    const endLine = sym.range.end.line;
    if (startLine <= line - 1 && line - 1 <= endLine) {
      const kindStr = typeof sym.kind === 'string' ? sym.kind : '';
      if (kindStr === 'Method' || kindStr === 'Constructor' || (sym.kind as any) === 6 || (sym.kind as any) === 9) {
        return sym.name;
      }
      if (sym.children) {
        return findEnclosingMethod(sym.children, line);
      }
    }
  }
  return null;
}

function findEnclosingClass(sourceLines: string[], fileUri: string): string {
  let packageName = '';
  for (const line of sourceLines) {
    const pm = line.match(/^package\s+([\w.]+)\s*;/);
    if (pm) {
      packageName = pm[1];
      break;
    }
  }
  for (const line of sourceLines) {
    const cm = line.match(/(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/);
    if (cm) {
      return packageName ? `${packageName}.${cm[1]}` : cm[1];
    }
  }
  const uriMatch = fileUri.match(/(?:src\/main\/java\/|src\/test\/java\/)(.+?)\.java$/);
  return uriMatch ? uriMatch[1].replace(/\//g, '.') : fileUri;
}

function findEnclosingBranch(sourceLines: string[], line: number): string | null {
  for (let i = line - 1; i >= 0 && i >= line - 30; i--) {
    const l = sourceLines[i].trim();
    const ifm = l.match(/^\s*\}?\s*else\s*if\s*\((.+?)\)\s*\{?/);
    if (ifm) return `else if(${ifm[1]})`;
    const elsem = l.match(/^\s*\}\s*else\s*\{?/);
    if (elsem) return 'else';
    const ifMatch = l.match(/^\s*if\s*\((.+?)\)\s*\{?/);
    if (ifMatch) return `if(${ifMatch[1]})`;
    const switchMatch = l.match(/^\s*switch\s*\((.+?)\)\s*\s*\{/);
    if (switchMatch) return `switch(${switchMatch[1]})`;
    const caseMatch = l.match(/^\s*case\s+(.+?)\s*:/);
    if (caseMatch) return `case ${caseMatch[1]}`;
    const defaultMatch = l.match(/^\s*default\s*:/);
    if (defaultMatch) return 'default';
  }
  return null;
}

function inferImpact(sourceLine: string): ReferenceImpact {
  const setterMatch = sourceLine.match(/\.set\w+\(\s*(.+?)\s*\)/);
  if (setterMatch) {
    return { value: null, valueSource: setterMatch[1].trim() };
  }
  const assignMatch = sourceLine.match(/=\s*(.+?)\s*[;,)]/);
  if (assignMatch) {
    const rhs = assignMatch[1].trim();
    if (/^[\d.]+[fFLlDd]?$/.test(rhs)) return { value: rhs, valueSource: null };
    if (/^".*"$/.test(rhs)) return { value: rhs, valueSource: null };
    if (/^(true|false)$/.test(rhs)) return { value: rhs, valueSource: null };
    return { value: null, valueSource: rhs };
  }
  return { value: null, valueSource: null };
}

export function enhanceReference(
  loc: Location,
  fieldName: string,
  documentSymbolsCache: Map<string, DocumentSymbol[]>,
  sourceLinesCache: Map<string, string[]>
): EnhancedReference {
  const filePath = loc.uri.replace('file://', '').replace(/^\/([A-Za-z]:)/, '$1');
  const lineNumber = loc.range.start.line + 1;
  const sourceLine = readSourceLine(filePath, lineNumber);

  if (!sourceLinesCache.has(filePath)) {
    sourceLinesCache.set(filePath, readSourceLines(filePath));
  }
  const allLines = sourceLinesCache.get(filePath)!;

  const accessType = classifyAccessType(sourceLine);
  const via = classifyVia(sourceLine, fieldName);
  let targetMethod: string | null = null;

  if (via === 'getter' || via === 'setter') {
    const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
    const prefix = via === 'getter' ? 'get' : 'set';
    targetMethod = `${prefix}${capitalized}`;
  }

  let enclosingMethod: string | null = 'unknown';
  if (documentSymbolsCache.has(filePath)) {
    const symbols = documentSymbolsCache.get(filePath)!;
    enclosingMethod = findEnclosingMethod(symbols, lineNumber);
  }

  const enclosingClass = findEnclosingClass(allLines, loc.uri);
  const branch = findEnclosingBranch(allLines, lineNumber);

  const context: ReferenceContext = {
    enclosingMethod: enclosingMethod || 'unknown',
    enclosingClass,
    branch,
  };

  const impact = inferImpact(sourceLine);

  return {
    ...loc,
    sourceLine,
    accessType,
    via,
    targetMethod,
    context,
    impact,
  };
}
