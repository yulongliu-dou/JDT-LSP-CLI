/**
 * 字段生命周期分析服务
 *
 * 为 refs --lifecycle 和 definition 增强提供字段级语义分析。
 * 函数式导出，无共享状态，可被 daemon route handler 和 CLI 直接复用。
 */

import * as fs from 'fs';
import { FieldAnnotation, AnnotationGroup } from '../core/types';

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
