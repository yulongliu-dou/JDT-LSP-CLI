#!/usr/bin/env node
/**
 * 版本更新工具
 * 
 * 使用方法：
 * node scripts/update-version.js <new-version>
 * 
 * 例如：
 * node scripts/update-version.js 1.7.2
 * 
 * 此脚本会自动更新：
 * 1. package.json
 * 2. src/core/constants.ts (PACKAGE_VERSION)
 */

const fs = require('fs');
const path = require('path');

// 获取新版本号
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('❌ 错误：请提供新版本号');
  console.error('使用方法：node scripts/update-version.js <new-version>');
  console.error('例如：node scripts/update-version.js 1.7.2');
  process.exit(1);
}

// 验证版本号格式 (semver)
const semverRegex = /^\d+\.\d+\.\d+$/;
if (!semverRegex.test(newVersion)) {
  console.error('❌ 错误：版本号格式不正确，应为 x.y.z 格式');
  console.error('例如：1.7.2');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');

console.log(`🔄 开始更新版本号到: ${newVersion}\n`);

// 1. 更新 package.json
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const oldVersion = packageJson.version;
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✅ package.json: ${oldVersion} → ${newVersion}`);

// 2. 更新 constants.ts
const constantsPath = path.join(rootDir, 'src', 'core', 'constants.ts');
let constantsContent = fs.readFileSync(constantsPath, 'utf-8');

// 使用正则表达式替换 PACKAGE_VERSION 的值
const versionRegex = /(export const PACKAGE_VERSION = )'[^']+'(;)/;
const oldConstantsVersion = constantsContent.match(/export const PACKAGE_VERSION = '([^']+)'/)?.[1];

if (oldConstantsVersion) {
  constantsContent = constantsContent.replace(versionRegex, `$1'${newVersion}'$2`);
  fs.writeFileSync(constantsPath, constantsContent);
  console.log(`✅ src/core/constants.ts: ${oldConstantsVersion} → ${newVersion}`);
} else {
  console.error('❌ 错误：未能在 constants.ts 中找到 PACKAGE_VERSION 定义');
  process.exit(1);
}

console.log(`\n🎉 版本更新完成！`);
console.log(`\n下一步：`);
console.log(`1. 运行: npm run build`);
console.log(`2. 测试功能是否正常`);
console.log(`3. 运行: npm publish`);
console.log(`4. 运行: git add package.json src/core/constants.ts`);
console.log(`5. 运行: git commit -m "chore: 版本更新 ${oldVersion} → ${newVersion}"`);
console.log(`6. 运行: git push`);
