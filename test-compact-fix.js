/**
 * 测试 --json-compact 修复效果
 * 验证包装对象+内部数组的数据结构能正确紧凑化
 */

// 模拟 compactData 函数逻辑
const COMPACT_FIELDS = {
  symbols: ['name', 'kind', 'range.start.line'],
  sym: ['name', 'kind', 'range.start.line'],
  references: ['uri', 'range.start.line'],
  refs: ['uri', 'range.start.line'],
  implementations: ['uri', 'range.start.line'],
  impl: ['uri', 'range.start.line'],
  workspaceSymbols: ['name', 'kind', 'location.uri', 'location.range.start.line'],
  find: ['name', 'kind', 'location.uri', 'location.range.start.line'],
  f: ['name', 'kind', 'location.uri', 'location.range.start.line'],
};

function getNestedValue(obj, path) {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let curr = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!curr[keys[i]]) curr[keys[i]] = {};
    curr = curr[keys[i]];
  }
  curr[keys[keys.length - 1]] = value;
}

function compactItem(item, fields) {
  if (!item || typeof item !== 'object') return item;
  const result = {};
  for (const field of fields) {
    const value = getNestedValue(item, field);
    if (value !== undefined) {
      setNestedValue(result, field, value);
    }
  }
  return result;
}

// 新的 compactData 实现
function compactData(data, command) {
  const fields = COMPACT_FIELDS[command];
  if (!fields || !data) return data;
  
  if (Array.isArray(data)) {
    return data.map(item => compactItem(item, fields));
  }
  
  if (typeof data === 'object' && data !== null) {
    const arrayFieldMap = {
      'symbols': 'symbols',
      'sym': 'symbols',
      'references': 'references',
      'refs': 'references',
      'implementations': 'implementations',
      'impl': 'implementations',
      'workspaceSymbols': 'symbols',
      'find': 'symbols',
      'f': 'symbols',
    };
    
    const arrayField = arrayFieldMap[command];
    
    if (arrayField && Array.isArray(data[arrayField])) {
      return {
        ...data,
        [arrayField]: data[arrayField].map(item => compactItem(item, fields))
      };
    }
    
    return compactItem(data, fields);
  }
  
  return data;
}

// 测试用例
console.log('=== 测试 --json-compact 修复 ===\n');

// 测试1: symbols 命令（包装对象结构）
console.log('测试1: symbols 命令');
const symbolsData = {
  symbols: [
    { name: 'TestClass', kind: 'Class', detail: 'public class TestClass', range: { start: { line: 10, character: 0 } } },
    { name: 'main', kind: 'Method', detail: 'public static void main', range: { start: { line: 15, character: 4 } } },
  ],
  count: 2
};
const symbolsResult = compactData(symbolsData, 'symbols');
console.log('输入:', JSON.stringify(symbolsData, null, 2));
console.log('输出:', JSON.stringify(symbolsResult, null, 2));
console.log('✓ 保留 count 字段:', symbolsResult.count === 2 ? '是' : '否');
console.log('✓ symbols 数组被紧凑化:', symbolsResult.symbols[0].detail === undefined ? '是' : '否');
console.log('');

// 测试2: references 命令（包装对象结构）
console.log('测试2: references 命令');
const refsData = {
  references: [
    { uri: 'file:///test.java', range: { start: { line: 20, character: 10 }, end: { line: 20, character: 15 } } },
    { uri: 'file:///test.java', range: { start: { line: 30, character: 5 }, end: { line: 30, character: 10 } } },
  ],
  count: 2
};
const refsResult = compactData(refsData, 'refs');
console.log('输入:', JSON.stringify(refsData, null, 2));
console.log('输出:', JSON.stringify(refsResult, null, 2));
console.log('✓ 保留 count 字段:', refsResult.count === 2 ? '是' : '否');
console.log('✓ references 数组被紧凑化:', refsResult.references[0].range.end === undefined ? '是' : '否');
console.log('');

// 测试3: implementations 命令（包装对象结构）
console.log('测试3: implementations 命令');
const implData = {
  implementations: [
    { uri: 'file:///impl1.java', range: { start: { line: 5, character: 0 } } },
    { uri: 'file:///impl2.java', range: { start: { line: 10, character: 0 } } },
  ],
  count: 2
};
const implResult = compactData(implData, 'impl');
console.log('输入:', JSON.stringify(implData, null, 2));
console.log('输出:', JSON.stringify(implResult, null, 2));
console.log('✓ 保留 count 字段:', implResult.count === 2 ? '是' : '否');
console.log('');

// 测试4: find 命令（包装对象结构，使用 workspaceSymbols 字段配置）
console.log('测试4: find 命令');
const findData = {
  symbols: [
    { name: 'MyClass', kind: 'Class', containerName: 'com.example', location: { uri: 'file:///test.java', range: { start: { line: 1 } } } },
  ],
  count: 1
};
const findResult = compactData(findData, 'find');
console.log('输入:', JSON.stringify(findData, null, 2));
console.log('输出:', JSON.stringify(findResult, null, 2));
console.log('✓ 保留 count 字段:', findResult.count === 1 ? '是' : '否');
console.log('✓ symbols 数组被紧凑化:', findResult.symbols[0].containerName === undefined ? '是' : '否');
console.log('');

// 测试5: definition 命令（直接数组结构，应保持不变）
console.log('测试5: definition 命令（直接数组）');
const defData = [
  { uri: 'file:///def.java', range: { start: { line: 10, character: 5 } } }
];
const defResult = compactData(defData, 'definition');
console.log('输入:', JSON.stringify(defData, null, 2));
console.log('输出:', JSON.stringify(defResult, null, 2));
console.log('✓ 数组被正确处理:', Array.isArray(defResult) ? '是' : '否');
console.log('');

console.log('=== 所有测试完成 ===');
