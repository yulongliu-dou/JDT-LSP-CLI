/**
 * CLI 输出处理工具
 */

import { COMPACT_FIELDS, ResponseMetadata } from '../../core/types';

/**
 * 紧凑化数据对象（只保留指定字段）
 * 
 * 支持两种数据结构：
 * 1. 直接数组：[...] - 对数组元素进行字段提取
 * 2. 包装对象：{ field: [...], count: N } - 对内部数组进行字段提取，保留包装结构
 */
export function compactData(data: any, command: string): any {
  const fields = (COMPACT_FIELDS as any)[command];
  if (!fields || !data) return data;
  
  // 处理数组（直接返回数组的情况）
  if (Array.isArray(data)) {
    return data.map(item => compactItem(item, fields));
  }
  
  // 处理对象 - 检查是否是包装对象结构
  if (typeof data === 'object' && data !== null) {
    // 定义命令到数组字段的映射（包装对象中的数组字段名）
    const arrayFieldMap: Record<string, string> = {
      'symbols': 'symbols',
      'sym': 'symbols',
      'references': 'references',
      'refs': 'references',
      'implementations': 'implementations',
      'impl': 'implementations',
      'workspaceSymbols': 'symbols',
      'find': 'symbols',
      'f': 'symbols',
      'typeDefinition': 'locations',
      'typedef': 'locations',
    };
    
    const arrayField = arrayFieldMap[command];
    
    // 如果是包装对象结构，对内部数组进行紧凑化
    if (arrayField && Array.isArray(data[arrayField])) {
      return {
        ...data,
        [arrayField]: data[arrayField].map((item: any) => compactItem(item, fields))
      };
    }
    
    // 否则对整个对象进行字段提取
    return compactItem(data, fields);
  }
  
  return data;
}

function compactItem(item: any, fields: string[]): any {
  if (!item || typeof item !== 'object') return item;
  
  const result: any = {};
  for (const field of fields) {
    const value = getNestedValue(item, field);
    if (value !== undefined) {
      setNestedValue(result, field, value);
    }
  }
  return result;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let curr = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!curr[keys[i]]) curr[keys[i]] = {};
    curr = curr[keys[i]];
  }
  curr[keys[keys.length - 1]] = value;
}

/**
 * 输出 JSON 结果（支持紧凑模式）
 */
export function outputResult<T>(result: any, command?: string, compact?: boolean): void {
  let output = result;
  if (compact && result.data && command) {
    // 构建元数据
    const metadata: ResponseMetadata = {
      compactMode: true,
    };
    
    // symbols/sym 命令特殊标记：children 被省略
    if (command === 'symbols' || command === 'sym') {
      metadata.childrenExcluded = true;
    }
    
    output = { 
      ...result, 
      data: compactData(result.data, command) as T,
      metadata
    };
  }
  console.log(JSON.stringify(output, null, compact ? 0 : 2));
  process.exit(result.success ? 0 : 1);
}
