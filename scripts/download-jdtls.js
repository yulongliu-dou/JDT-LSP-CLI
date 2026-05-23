#!/usr/bin/env node
/**
 * prepublishOnly 脚本
 * 从 Eclipse 下载 JDT LS tar.gz 到项目 jdtls/ 目录
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ECLIPSE_MILESTONES_URL = 'https://download.eclipse.org/jdtls/milestones/';
const JDTLS_DEFAULT_VERSION = '1.58.0';
const JDTLS_DIR = path.join(__dirname, '..', 'jdtls');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * HTTP GET 请求
 */
function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { timeout }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 解析 milestones HTML 页面获取版本列表
 */
function parseVersions(html) {
  const versions = [];
  const re = /href="\/jdtls\/milestones\/([\d.]+)\//g;
  let match;
  while ((match = re.exec(html)) !== null) {
    versions.push(match[1]);
  }
  return versions;
}

/**
 * semver 排序取最大
 */
function sortVersions(versions) {
  return versions.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na !== nb) return nb - na;
    }
    return 0;
  });
}

/**
 * 带进度条的下载
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { timeout: 600000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastUpdate = Date.now();

      const fileStream = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        if (now - lastUpdate >= 200) {
          renderProgress(downloaded, total);
          lastUpdate = now;
        }
      });
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        renderProgress(total || downloaded, total || downloaded);
        process.stdout.write('\n');
        resolve();
      });
      fileStream.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

function renderProgress(downloaded, total) {
  if (total === 0) {
    process.stdout.write(`\r  下载中... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
    return;
  }
  const pct = Math.min(100, Math.round((downloaded / total) * 100));
  const barWidth = 30;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  process.stdout.write(
    `\r  ${bar} ${pct}%  ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`
  );
}

async function main() {
  console.log('[download-jdtls] 正在获取 JDT LS 最新版本...');

  let version = JDTLS_DEFAULT_VERSION;
  let assetUrl = null;
  let sha256Url = null;
  let filename = null;

  try {
    // 获取版本列表
    const html = await httpGet(ECLIPSE_MILESTONES_URL);
    const versions = parseVersions(html);
    if (versions.length > 0) {
      const sorted = sortVersions(versions);
      version = sorted[0];
    }
    console.log(`[download-jdtls] 最新版本: ${version}`);

    // 获取文件名
    const latestTxt = await httpGet(`${ECLIPSE_MILESTONES_URL}${version}/latest.txt`);
    filename = latestTxt.trim();
    if (!filename || !filename.endsWith('.tar.gz')) {
      throw new Error(`Invalid latest.txt: "${filename}"`);
    }

    assetUrl = `${ECLIPSE_MILESTONES_URL}${version}/${filename}`;
    sha256Url = `${assetUrl}.sha256`;
  } catch (err) {
    console.error(`[download-jdtls] 获取下载链接失败: ${err.message}`);
    console.error('[download-jdtls] 构建将跳过 JDT LS 打包');
    process.exit(0);
  }

  ensureDir(JDTLS_DIR);

  // 下载 tar.gz
  const destFile = path.join(JDTLS_DIR, filename);
  if (fs.existsSync(destFile)) {
    console.log(`[download-jdtls] ${filename} 已存在，跳过下载`);
  } else {
    console.log(`[download-jdtls] 正在下载 ${filename} (来源: ${assetUrl})...`);
    await downloadFile(assetUrl, destFile);
    console.log(`[download-jdtls] 下载完成: ${destFile}`);
  }

  // 下载 SHA256
  const sha256File = path.join(JDTLS_DIR, filename + '.sha256');
  if (!fs.existsSync(sha256File)) {
    try {
      const sha256Content = await httpGet(sha256Url);
      fs.writeFileSync(sha256File, sha256Content, 'utf-8');
      console.log(`[download-jdtls] SHA256 已保存: ${sha256File}`);

      // 校验
      const expectedHex = sha256Content.trim().split(/\s+/)[0];
      const fileHash = crypto.createHash('sha256');
      const fileData = fs.readFileSync(destFile);
      fileHash.update(fileData);
      const actualHex = fileHash.digest('hex');
      if (actualHex === expectedHex) {
        console.log('[download-jdtls] ✓ SHA256 校验通过');
      } else {
        console.error(`[download-jdtls] ✗ SHA256 校验失败!`);
        console.error(`  期望: ${expectedHex}`);
        console.error(`  实际: ${actualHex}`);
        process.exit(1);
      }
    } catch (err) {
      console.warn(`[download-jdtls] SHA256 下载失败: ${err.message}`);
    }
  }

  // 写入 version.json
  const versionJson = {
    version,
    filename,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(JDTLS_DIR, 'version.json'),
    JSON.stringify(versionJson, null, 2),
    'utf-8'
  );
  console.log(`[download-jdtls] version.json 已写入: ${JSON.stringify(versionJson)}`);

  // 清理旧版本
  const entries = fs.readdirSync(JDTLS_DIR);
  for (const entry of entries) {
    if (entry.endsWith('.tar.gz') && entry !== filename) {
      const oldFile = path.join(JDTLS_DIR, entry);
      fs.unlinkSync(oldFile);
      console.log(`[download-jdtls] 已清理旧版本: ${entry}`);
    }
  }

  console.log('[download-jdtls] ✓ 完成');
}

main().catch((err) => {
  console.error(`[download-jdtls] 致命错误: ${err.message}`);
  process.exit(1);
});
