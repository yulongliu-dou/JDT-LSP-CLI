/**
 * 字段生命周期分析服务
 *
 * 为 refs --lifecycle 和 definition 增强提供字段级语义分析。
 * 函数式导出，无共享状态，可被 daemon route handler 和 CLI 直接复用。
 */

import * as fs from 'fs';
import { FieldAnnotation, AnnotationGroup, EnhancedReference, ReferenceContext, ReferenceImpact, Location, AccessType, ViaType, DocumentSymbol, LifecycleSummary, LifecycleResult, LifecycleHints, PropagationTarget, EnumMapping, DtoChainInfo, ConditionalPathSummary, SameNameFieldHint, FieldFlowResult } from '../core/types';

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
  fieldLineIndex: number,
  fieldName: string,
  className: string
): AnnotationGroup {
  const annotations: AnnotationGroup = {};

  const lombok = detectLombokAnnotations(sourceLines, className);
  if (lombok.length) annotations.lombok = lombok;

  // check both the field line and the line above it for annotations
  const fieldSourceLine = sourceLines[fieldLineIndex]?.trim() || '';
  const prevLine = fieldLineIndex > 0 ? (sourceLines[fieldLineIndex - 1]?.trim() || '') : '';

  const json = [
    ...detectJsonAnnotations(fieldSourceLine, fieldName, className),
    ...detectJsonAnnotations(prevLine, fieldName, className),
  ];
  if (json.length) annotations.json = json;

  const dbTable = detectTableAnnotation(sourceLines, className);
  const dbCol = [
    ...detectDbAnnotations(fieldSourceLine, fieldName, className),
    ...detectDbAnnotations(prevLine, fieldName, className),
  ];
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

// ========== 生命周期分析主引擎 ==========

export interface LspClient {
  getReferences(filePath: string, line: number, col: number, includeDecl: boolean): Promise<Location[]>;
  getDocumentSymbols(filePath: string): Promise<DocumentSymbol[]>;
  getDocumentHighlight(filePath: string, line: number, col: number): Promise<any[]>;
  getHover(filePath: string, line: number, col: number): Promise<any>;
}

function walkJavaFiles(dir: string, callback: (filePath: string) => void): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = dir + '/' + entry.name;
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'target') {
        walkJavaFiles(fullPath, callback);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        callback(fullPath);
      }
    }
  } catch { /* skip unreadable directories */ }
}

function discoverSameNameFields(
  fieldName: string,
  currentClass: string,
  projectPath: string
): PropagationTarget[] {
  const targets: PropagationTarget[] = [];
  try {
    walkJavaFiles(projectPath, (filePath) => {
      if (filePath.includes(currentClass.replace(/\./g, '/'))) return;
      const lines = readSourceLines(filePath);
      for (const line of lines) {
        const fm = new RegExp(
          `\\b(private|protected|public)\\s+\\S+\\s+${fieldName}\\b\\s*[;=]`
        ).exec(line);
        if (fm) {
          const className = findEnclosingClass(lines, `file:///${filePath.replace(/\\/g, '/')}`);
          const typeMatch = line.match(/\b(private|protected|public)\s+(\S+)\s+\w+/);
          targets.push({
            class: className,
            field: fieldName,
            type: typeMatch ? typeMatch[2] : 'unknown',
          });
          break;
        }
      }
    });
  } catch { /* traversal failure is non-blocking */ }
  return targets;
}

function detectDtoChain(
  sourcePath: string,
  fieldName: string,
  propagationTargets: PropagationTarget[]
): DtoChainInfo {
  const chains: Array<{ path: string; methods: string[] }> = [];
  try {
    walkJavaFiles(sourcePath, (filePath) => {
      const lines = readSourceLines(filePath);
      const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
      const getSetPattern = new RegExp(
        `\\.(get|is)${capitalized}\\(\\).*\\.set${capitalized}\\(`
      );
      for (const line of lines) {
        const methodMatch = line.match(
          /\b(?:public|private|protected)\s+(?:\w+\s+)*(\w+)\s*\(/
        );
        if (getSetPattern.test(line) && methodMatch) {
          chains.push({
            path: 'detected via get->set copy pattern',
            methods: [methodMatch[1]],
          });
          break;
        }
      }
    });
  } catch { /* detection failure is non-blocking */ }
  return { chains };
}

function detectConditionalPaths(
  sourcePath: string,
  fieldName: string
): ConditionalPathSummary[] {
  const summaries: ConditionalPathSummary[] = [];
  try {
    walkJavaFiles(sourcePath, (filePath) => {
      const lines = readSourceLines(filePath);
      let inConditional = false;
      let currentCondition = '';
      let assignments: Array<{ condition: string; assignment: string }> = [];
      let currentMethod = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        const mm = line.match(/\b(public|private|protected)\s+\S+\s+(\w+)\s*\(/);
        if (mm) {
          if (inConditional && assignments.length > 0) {
            summaries.push({
              method: currentMethod,
              branches: assignments.length,
              details: assignments,
            });
          }
          currentMethod = mm[2];
          inConditional = false;
          assignments = [];
        }

        const ifm = line.match(/^\s*\}?\s*else\s+if\s*\((.+?)\)\s*\{?/);
        if (ifm) { inConditional = true; currentCondition = `else if(${ifm[1]})`; continue; }
        const elsem = /^\s*\}\s*else\s*\{?/.test(line);
        if (elsem) { inConditional = true; currentCondition = 'else'; continue; }
        const ifMatch = line.match(/^\s*if\s*\((.+?)\)\s*\{?/);
        if (ifMatch) { inConditional = true; currentCondition = `if(${ifMatch[1]})`; continue; }

        if (inConditional && new RegExp(`\\b${fieldName}\\s*=|\\.set\\w*${fieldName}\\w*\\(`).test(line)) {
          assignments.push({ condition: currentCondition, assignment: line });
        }

        if (inConditional && /^\s*\}$/.test(line)) {
          inConditional = false;
        }
      }
    });
  } catch { /* detection failure is non-blocking */ }
  return summaries;
}

function flattenSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
  const result: DocumentSymbol[] = [];
  for (const sym of symbols) {
    result.push(sym);
    if (sym.children) result.push(...flattenSymbols(sym.children));
  }
  return result;
}

function isMethodSymbol(sym: DocumentSymbol): boolean {
  const k: any = sym.kind;
  return k === 'Method' || k === 'Constructor' || k === 6 || k === 9;
}

function isEnumType(typeName: string): boolean {
  return /^[A-Z][a-zA-Z]*Status$|^[A-Z][a-zA-Z]*Type$|^[A-Z][a-zA-Z]*Enum$/.test(typeName);
}

function buildHints(
  targets: PropagationTarget[],
  refs: EnhancedReference[],
  projectPath: string,
  fieldName: string
): LifecycleHints {
  let detectedLibraries: string[] = [];
  try {
    const pomPath = projectPath + '/pom.xml';
    if (fs.existsSync(pomPath)) {
      const pom = fs.readFileSync(pomPath, 'utf-8');
      if (pom.includes('spring-beans')) detectedLibraries.push('spring-beans');
      if (pom.includes('mapstruct')) detectedLibraries.push('mapstruct');
      if (pom.includes('hibernate')) detectedLibraries.push('hibernate');
    }
  } catch { /* ignore */ }

  const sameNameFields: SameNameFieldHint[] = [];
  const suspected = new Set<string>();
  for (const ref of refs) {
    const line = ref.sourceLine;
    const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
    if (new RegExp(`\\.get${capitalized}\\(\\).*\\.set${capitalized}\\(`).test(line)) {
      const className = ref.context.enclosingClass;
      if (!suspected.has(className)) {
        suspected.add(className);
        sameNameFields.push({
          class: className,
          field: fieldName,
          confidence: 'high',
          reason: `get->set copy pattern: ${line}`,
        });
      }
    }
  }

  return {
    propagationConfidence: targets.length > 0 ? 'partial' : 'none',
    sameNameFields,
    ...(detectedLibraries.length > 0 ? {
      reflectionRisk: {
        detectedLibraries,
        suspectedPatterns: ['BeanUtils.copyProperties', 'MapStruct mapping'],
        advice: `detected ${detectedLibraries.join(', ')}; possible implicit copy. Use jls refs --lifecycle --symbol ${fieldName} <targetClass> to verify per-class`,
      },
    } : {}),
    unreachableViaJdtLs: [
      {
        concern: 'JSON deserialization entry',
        detail: 'Jackson @JsonProperty runtime reflection calls are invisible to static analysis',
        agentAdvice: 'use runtime logs or HTTP request body to confirm JSON deserialization path',
      },
      {
        concern: 'DB ORM field mapping',
        detail: '@Column/@TableField runtime ORM reflection assignments are invisible to static analysis',
        agentAdvice: 'use SQL logs to confirm insert/update/select column read/write operations',
      },
    ],
  };
}

export async function analyzeFieldLifecycle(
  fieldName: string,
  fieldType: string,
  containingClass: string,
  declaringFilePath: string,
  declaringLine: number,
  declaringCol: number,
  projectPath: string,
  client: LspClient,
  includeDeclaration: boolean = true
): Promise<LifecycleResult> {
  const rawRefs = await client.getReferences(declaringFilePath, declaringLine, declaringCol, includeDeclaration);

  const documentSymbolsCache = new Map<string, DocumentSymbol[]>();
  const sourceLinesCache = new Map<string, string[]>();

  try {
    const syms = await client.getDocumentSymbols(declaringFilePath);
    documentSymbolsCache.set(declaringFilePath, syms);
  } catch { /* non-blocking */ }

  const declLines = readSourceLines(declaringFilePath);
  sourceLinesCache.set(declaringFilePath, declLines);

  const annotations = extractAnnotations(declLines, declaringLine - 1, fieldName, containingClass);

  // discover getter/setter methods from documentSymbols
  const capitalizedName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  const getterName = `get${capitalizedName}`;
  const setterName = `set${capitalizedName}`;
  const isGetterName = `is${capitalizedName}`;

  let getterRefs: Location[] = [];
  let setterRefs: Location[] = [];

  const symbols = documentSymbolsCache.get(declaringFilePath);
  if (symbols) {
    const flatSymbols = flattenSymbols(symbols);
    const getterSym = flatSymbols.find(
      s => (s.name === getterName || s.name === isGetterName) && isMethodSymbol(s)
    );
    const setterSym = flatSymbols.find(
      s => s.name === setterName && isMethodSymbol(s)
    );

    if (getterSym) {
      try {
        getterRefs = await client.getReferences(
          declaringFilePath,
          getterSym.selectionRange.start.line + 1,
          getterSym.selectionRange.start.character + 1,
          false
        );
      } catch { /* non-blocking */ }
    }
    if (setterSym) {
      try {
        setterRefs = await client.getReferences(
          declaringFilePath,
          setterSym.selectionRange.start.line + 1,
          setterSym.selectionRange.start.character + 1,
          false
        );
      } catch { /* non-blocking */ }
    }
  }

  // preload symbols for getter/setter reference files
  for (const ref of [...getterRefs, ...setterRefs]) {
    const refFilePath = ref.uri.replace('file://', '').replace(/^\/([A-Za-z]:)/, '$1');
    if (!documentSymbolsCache.has(refFilePath)) {
      try {
        const syms = await client.getDocumentSymbols(refFilePath);
        documentSymbolsCache.set(refFilePath, syms);
      } catch { /* non-blocking */ }
    }
  }

  // enhance and deduplicate
  const enhancedRefs: EnhancedReference[] = [];
  const seen = new Set<string>();

  function dedupKey(loc: Location): string {
    return `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`;
  }

  for (const ref of rawRefs) {
    const key = dedupKey(ref);
    if (!seen.has(key)) {
      seen.add(key);
      const enhanced = enhanceReference(ref, fieldName, documentSymbolsCache, sourceLinesCache);
      enhanced.via = enhanced.via === 'unknown' ? 'direct' : enhanced.via;
      enhancedRefs.push(enhanced);
    }
  }

  for (const ref of getterRefs) {
    const key = dedupKey(ref);
    if (!seen.has(key)) {
      seen.add(key);
      const enhanced = enhanceReference(ref, fieldName, documentSymbolsCache, sourceLinesCache);
      enhanced.via = 'getter';
      enhanced.targetMethod = getterName;
      enhancedRefs.push(enhanced);
    }
  }

  for (const ref of setterRefs) {
    const key = dedupKey(ref);
    if (!seen.has(key)) {
      seen.add(key);
      const enhanced = enhanceReference(ref, fieldName, documentSymbolsCache, sourceLinesCache);
      enhanced.via = 'setter';
      enhanced.targetMethod = setterName;
      enhancedRefs.push(enhanced);
    }
  }

  // build stats
  const accessStats = { read: 0, write: 0 };
  const viaStats = { direct: 0, getter: 0, setter: 0 };
  for (const ref of enhancedRefs) {
    if (ref.accessType === 'read' || ref.accessType === 'readWrite') accessStats.read++;
    if (ref.accessType === 'write' || ref.accessType === 'readWrite') accessStats.write++;
    if (ref.via === 'direct' || ref.via === 'unknown') viaStats.direct++;
    else if (ref.via === 'getter') viaStats.getter++;
    else if (ref.via === 'setter') viaStats.setter++;
  }

  const propagationTargets = discoverSameNameFields(fieldName, containingClass, projectPath);

  // enum mapping detection
  let enumMapping: EnumMapping | undefined;
  if (fieldType && isEnumType(fieldType)) {
    walkJavaFiles(projectPath, (filePath) => {
      const lines = readSourceLines(filePath);
      const joined = lines.join('\n');
      const enumMatch = joined.match(
        new RegExp(`enum\\s+${fieldType}\\s*\\{([^}]+)\\}`, 's')
      );
      if (enumMatch) {
        const body = enumMatch[1];
        const constPattern = /(\w+)\s*\(\s*([^,]+?)\s*,\s*"([^"]+)"\s*\)/g;
        const constants: EnumMapping['constants'] = [];
        let cm;
        while ((cm = constPattern.exec(body)) !== null) {
          constants.push({
            name: cm[1],
            value: cm[2].trim(),
            description: cm[3],
          });
        }
        const resolverMethods: string[] = [];
        for (const line of lines) {
          if (line.includes('fromValue') || line.includes('from') && line.includes('static')) {
            const rmm = line.match(/public\s+static\s+\S+\s+(\w+)\s*\(/);
            if (rmm) resolverMethods.push(rmm[1]);
          }
        }
        enumMapping = {
          enumClass: filePath.replace(/\\/g, '/'),
          constants,
          resolverMethods,
        };
      }
    });
  }

  const dtoChain = detectDtoChain(projectPath, fieldName, propagationTargets);
  const conditionalPaths = detectConditionalPaths(projectPath, fieldName);

  const summary: LifecycleSummary = {
    field: { name: fieldName, type: fieldType, containingClass },
    annotations,
    accessStats,
    viaStats,
    propagationTargets,
    ...(enumMapping ? { enumMapping } : {}),
    ...(dtoChain.chains.length > 0 ? { dtoChain } : {}),
    ...(conditionalPaths.length > 0 ? { conditionalPaths } : {}),
  };

  const hints = buildHints(propagationTargets, enhancedRefs, projectPath, fieldName);

  return { summary, references: enhancedRefs, hints };
}

// ========== 二期：callHierarchy --lifecycle 字段流分析 ==========

/**
 * 从方法签名 detail 中解析参数名→类型名映射
 *
 * detail 格式示例:
 *   "OrderVO dtoToVo(OrderDTO dto)"    → { dto: "OrderDTO" }
 *   "void process(OrderEntity entity, boolean flag)" → { entity: "OrderEntity", flag: "boolean" }
 *   "void setStatus(Integer status)"     → { status: "Integer" }
 */
function parseParameterTypes(detail: string): Map<string, string> {
  const map = new Map<string, string>();
  const parenStart = detail.indexOf('(');
  const parenEnd = detail.lastIndexOf(')');
  if (parenStart < 0 || parenEnd < 0) return map;

  const paramsStr = detail.substring(parenStart + 1, parenEnd).trim();
  if (!paramsStr) return map;

  for (const param of paramsStr.split(',')) {
    const trimmed = param.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const typeName = parts.slice(0, -1).join(' ');
      const varName = parts[parts.length - 1];
      if (typeName !== 'int' && typeName !== 'long' && typeName !== 'boolean' &&
          typeName !== 'double' && typeName !== 'float' && typeName !== 'byte' &&
          typeName !== 'short' && typeName !== 'char') {
        map.set(varName, typeName.replace(/^.*\./, ''));
      }
    }
  }
  return map;
}

/**
 * 从方法体源码中提取局部变量声明 → 类型映射
 *
 * 识别模式: "TypeName varName = new TypeName()" 或 "TypeName varName = ..."
 * 取简单类名
 */
function parseLocalVariables(
  bodyLines: string[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of bodyLines) {
    const m = line.match(
      /\b([A-Z]\w*(?:\s*<[^>]+>)?)\s+(\w+)\s*=/
    );
    if (m) {
      const typeName = m[1].replace(/\s+/g, '');
      const varName = m[2];
      if (!['int', 'long', 'boolean', 'double', 'float', 'byte', 'short', 'char',
            'String', 'Integer', 'Long', 'Boolean', 'Double', 'Float', 'BigDecimal',
            'List', 'Map', 'Set', 'ArrayList', 'HashMap'].includes(typeName.split('<')[0])) {
        map.set(varName, typeName);
      }
    }
  }
  return map;
}

/**
 * 分析被调用方法内部的字段读写操作
 *
 * 通过解析方法签名获取参数类型映射，扫描方法体中的 getter/setter 调用，
 * 解析变量→类名关系，返回该方法的字段读写清单。
 *
 * @param sourceLines - 方法所在文件的全部源码行
 * @param methodStartLine - 方法起始行号 (0-based)
 * @param methodEndLine - 方法结束行号 (0-based, inclusive)
 * @param methodDetail - 方法签名，如 "OrderVO dtoToVo(OrderDTO dto)"
 * @returns 字段读写信息
 */
export function analyzeMethodFieldFlow(
  sourceLines: string[],
  methodStartLine: number,
  methodEndLine: number,
  methodDetail: string
): FieldFlowResult {
  const paramTypes = parseParameterTypes(methodDetail);

  const bodyStartLine = methodStartLine + 1;
  const bodyLines: string[] = [];
  for (let i = bodyStartLine; i <= methodEndLine && i < sourceLines.length; i++) {
    bodyLines.push(sourceLines[i]);
  }

  const localVarTypes = parseLocalVariables(bodyLines);

  function resolveClassName(varName: string): string | null {
    if (paramTypes.has(varName)) return paramTypes.get(varName)!;
    if (localVarTypes.has(varName)) return localVarTypes.get(varName)!;
    return null;
  }

  const reads = new Set<string>();
  const writes = new Set<string>();

  for (const line of bodyLines) {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    const setterPattern = /(\w+)\.set(\w+)\s*\(/g;
    let sm;
    while ((sm = setterPattern.exec(line)) !== null) {
      const varName = sm[1];
      const fieldPart = sm[2];
      const fieldName = fieldPart.charAt(0).toLowerCase() + fieldPart.slice(1);
      const className = resolveClassName(varName);
      if (className) {
        writes.add(`${className}.${fieldName}`);
      }
    }

    const getterPattern = /(\w+)\.(?:get|is)(\w+)\s*\(\)/g;
    let gm;
    while ((gm = getterPattern.exec(line)) !== null) {
      const varName = gm[1];
      const fieldPart = gm[2];
      const fieldName = fieldPart.charAt(0).toLowerCase() + fieldPart.slice(1);
      const className = resolveClassName(varName);
      if (className) {
        reads.add(`${className}.${fieldName}`);
      }
    }
  }

  return {
    reads: Array.from(reads).sort(),
    writes: Array.from(writes).sort(),
  };
}
