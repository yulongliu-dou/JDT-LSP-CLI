#!/usr/bin/env node
/**
 * postinstall 脚本
 * 将 npm 包内置的 JDT LS tar.gz 解压到 ~/.jdt-lsp-cli/jdtls/<version>/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const JDTLS_STORAGE_DIR = path.join(HOME, '.jdt-lsp-cli', 'jdtls');
const JDTLS_PACKAGE_DIR = path.join(__dirname, '..', 'jdtls');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extractTarGz(archivePath, destDir) {
  ensureDir(destDir);
  // Windows tar 将盘符中的 : 误解为远程主机名；--force-local 强制本地路径
  const tarArchive = archivePath.replace(/\\/g, '/');
  const tarDest = destDir.replace(/\\/g, '/');
  execSync(`tar --force-local -xzf "${tarArchive}" -C "${tarDest}"`, {
    stdio: 'pipe',
    timeout: 120000,
  });

  // 如果解压后只有一个中间目录，将内容上移
  const entries = fs.readdirSync(destDir).filter(e => !e.startsWith('.'));
  if (entries.length === 1) {
    const innerDir = path.join(destDir, entries[0]);
    if (fs.statSync(innerDir).isDirectory()) {
      // NOTE: 若将来并发解压同一 destDir，此临时目录名可能冲突
      const tmpDir = destDir + '_tmp';
      fs.renameSync(innerDir, tmpDir);
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.renameSync(path.join(tmpDir, file), path.join(destDir, file));
      }
      fs.rmdirSync(tmpDir);
    }
  }
}

function validateJdtls(dirPath) {
  const pluginsDir = path.join(dirPath, 'plugins');
  if (!fs.existsSync(pluginsDir)) return false;
  try {
    const files = fs.readdirSync(pluginsDir);
    return files.some(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
  } catch {
    return false;
  }
}

function main() {
  // 检查是否有内置 tar.gz
  if (!fs.existsSync(JDTLS_PACKAGE_DIR)) {
    console.log('[extract-jdtls] 未找到内置 JDT LS 包，跳过解压');
    return;
  }

  const tarFiles = fs.readdirSync(JDTLS_PACKAGE_DIR).filter(f => f.endsWith('.tar.gz'));
  if (tarFiles.length === 0) {
    console.log('[extract-jdtls] 未找到内置 tar.gz，跳过解压');
    return;
  }

  // 读取版本信息
  let version = 'unknown';
  const versionJsonPath = path.join(JDTLS_PACKAGE_DIR, 'version.json');
  if (fs.existsSync(versionJsonPath)) {
    try {
      const vj = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
      version = vj.version || version;
    } catch { /* keep unknown */ }
  }

  const destDir = path.join(JDTLS_STORAGE_DIR, version);

  // 如果目标目录已存在且有效，跳过
  if (fs.existsSync(destDir) && validateJdtls(destDir)) {
    console.log(`[extract-jdtls] JDT LS ${version} 已存在，跳过解压`);
    return;
  }

  // 解压
  const tarFile = path.join(JDTLS_PACKAGE_DIR, tarFiles[0]);
  console.log(`[extract-jdtls] 正在解压 JDT LS ${version}...`);
  console.log(`  源文件: ${tarFile}`);
  console.log(`  目标: ${destDir}`);

  try {
    extractTarGz(tarFile, destDir);

    if (!validateJdtls(destDir)) {
      throw new Error('解压后找不到 launcher jar');
    }

    console.log(`[extract-jdtls] ✓ JDT LS ${version} 解压完成`);
  } catch (err) {
    console.error(`[extract-jdtls] ✗ 解压失败: ${err.message}`);
    console.error('');
    console.error('┌───────────────────────────────────────────────────────────┐');
    console.error('│ ⚠ JDT LS 解压失败                                      │');
    console.error('│                                                │');
    console.error('│ 请检查 npm 包内置 tar.gz 是否完整:               │');
    console.error(`│ 源文件: ${tarFile}  │`);
    console.error(`│ 目标: ${destDir}  │`);
    console.error('│                                                │');
    console.error('│ 或运行 jls jdt update 重新安装                  │');
    console.error('└───────────────────────────────────────────────────────────┘');
    console.error('');
    // 不阻止安装
  }
}

main();
