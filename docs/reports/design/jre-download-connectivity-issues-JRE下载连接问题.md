# JRE 下载源连通性问题记录

> 记录于 2026-05-23，在中国大陆网络环境下测试 JRE 自动下载功能时发现的问题。

## 测试结果矩阵

| 下载源 | 可达性 | 版本发现 | 二进制下载 | 备注 |
|--------|--------|----------|------------|------|
| `api.adoptium.net` | ❌ 超时 | ❌ | N/A | GFW 阻断，Node.js 连接超时 |
| `api.github.com/repos/adoptium/...` | ⚠️ 间歇 | ⚠️ | N/A | 有时正常(200)，有时 504/超时 |
| GitHub Releases 直链 | ❌ 超时 | N/A | ❌ | 二进制下载完全不可达 |
| 华为云镜像 `mirrors.huaweicloud.com/adoptium/` | ✅ | ❌ | ❌ | 返回 Portal HTML 而非文件，URL 结构猜测失败 |
| 清华 TUNA `mirrors.tuna.tsinghua.edu.cn/Adoptium/` | ✅ | ❌ | ❌ | SPA 页面，HTML 解析困难，且 JRE 路径 404 |
| **中科大 USTC `mirrors.ustc.edu.cn/adoptium/`** | ✅ | ✅ | ✅ | **唯一可用源**，有纯 HTML 目录列表 |

## 详细问题

### 1. Node.js `https.get` 超时不可靠

`http.get(url, { timeout: 15000 })` 的 timeout 仅在 socket 分配后生效。DNS 解析和 TCP 握手阶段不受超时控制，可能导致请求永久挂起。

**修复:** 添加 `withTimeout()` 包装函数用 `Promise.race` + `setTimeout` 做硬超时。

**涉及文件:** `src/jdt/embedded/jreManager.ts:fetchJreAssetFromGitHub()`

### 2. 镜像需要 User-Agent 头

中科大 USTC 镜像对无 `User-Agent` 头的请求返回 HTTP 403。

**修复:** 所有 HTTP 请求添加 `headers: { 'User-Agent': 'jdt-lsp-cli' }`。

**涉及文件:** `src/jdt/embedded/jreManager.ts:downloadFile()`, `fetchChecksumFromUrl()`, `fetchJreAssetFromUstcMirror()`

### 3. 镜像版本滞后

USTC 镜像当前最新版本为 `21.0.9+10`，而 GitHub 最新为 `21.0.11+10`。镜像同步存在延迟，但不影响功能。

### 4. Windows zip 解压后目录嵌套

PowerShell `Expand-Archive` 解压后的目录结构包含一个中间目录（如 `jdk-21.0.9+10-jre/`），而 `bin/` 在其内部。tar 分支有此处理逻辑但 PowerShell 分支遗漏。

**修复:** 将"上移一层"逻辑提取到 `extractJre()` 的公共位置，zip 和 tar 路径均执行。

**涉及文件:** `src/jdt/embedded/jreManager.ts:extractJre()`

### 5. 华为云镜像路径不可预测

华为云镜像站 (`mirrors.huaweicloud.com`) 对 Adoptium 的路径结构与标准 Adoptium 发布路径不兼容，URL 猜测失败。

### 6. GitHub API 与 USTC 镜像的 fallback 顺序 Bug

USTC 镜像调用被错误地放在 `if (asset)` 块内部，导致 GitHub API 失败时（asset 为 null）USTC 也被跳过。

**修复:** 将 USTC 调用移出 `if (asset)` 块，使其独立于 GitHub API 结果。

**涉及文件:** `src/jdt/embedded/jreManager.ts:ensure()`

## 最终下载链

```
GitHub API (版本发现, 15s 硬超时)
    ↓ 成功 → GitHub Releases 直链下载
    ↓ 失败
USTC 中科大镜像 (独立完成版本发现 + 下载)
    ↓ 失败
系统 JRE / JAVA_HOME / PATH → 版本检查 (>=21)
    ↓ 失败
VS Code 扩展 JRE → 提示安装
    ↓ 失败
手动下载指引 (throw Error, 不再 process.exit)
```

## 待优化

1. **镜像优先级可配置**: 允许用户通过 CLI 参数或配置文件指定首选镜像
2. **多镜像并发探测**: 同时探测多个镜像，选最快的
3. **镜像列表自动更新**: 从远端获取最新镜像列表
4. **华为云/清华镜像接入**: 研究正确的 URL 结构后加入镜像列表
5. **代理支持**: 支持 HTTP/HTTPS 代理环境变量
