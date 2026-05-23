# JDT LS 自动安装设计文档

> **Agentic workers:** 使用 superpowers:writing-plans 将本设计转换为实施计划。

**目标:** npm 包构建时打包 JDT LS tar.gz (~49MB)，安装时 postinstall 解压，实现脱离 VS Code 红帽扩展的独立运行。

**架构:** 复用 JRE 下载基础设施，`prepublishOnly` 下载 → npm 包内置 tar.gz → `postinstall` 解压到 `~/.jdt-lsp-cli/jdtls/`。`JdtLauncher` 优先级：内嵌 > VS Code 扩展(询问) > 手动指引。

**技术栈:** Node.js 内置模块 (https/fs/path/zlib/tar)，`download.eclipse.org/jdtls/milestones/` 作为下载源。

---

## 1. JDT LS 下载源

### 1.1 版本信息

- **下载地址**: `https://download.eclipse.org/jdtls/milestones/`
- **最新版本**: `1.58.0` (2026-04-15)，每月发布一个新版本
- **文件命名**: `jdt-language-server-{version}-{timestamp}.tar.gz`
- **实际 URL**: `https://download.eclipse.org/jdtls/milestones/1.58.0/jdt-language-server-1.58.0-202604151538.tar.gz`
- **压缩大小**: ~49 MB
- **解压后**: ~182 MB
- **平台**: 单一 tar.gz 适配 Windows/macOS/Linux（纯 Java 项目）
- **SHA256**: 同 URL 追加 `.sha256`

### 1.2 版本发现

Eclipse 不提供 REST API，需解析 `/milestones/` HTML 目录页面获取版本列表。使用正则提取 `<a href='/jdtls/milestones/X.Y.Z/'>` 中的版本号，排序取最大。

每个版本目录包含：
- `jdt-language-server-{version}-{timestamp}.tar.gz` — 压缩包
- `jdt-language-server-{version}-{timestamp}.tar.gz.sha256` — 校验和
- `latest.txt` — 包含该目录下的 tar.gz 文件名
- `repository/` — Eclipse p2 仓库（不需要）

### 1.3 tar.gz 内部结构

```
jdt-language-server-{version}/
├── features/           # Eclipse features
├── plugins/            # JDT LS 插件 + org.eclipse.equinox.launcher_*.jar
├── config_win/         # Windows 配置
├── config_mac/         # macOS 配置
├── config_linux/       # Linux 配置
└── ...
```

解压后结构与当前 `findJdtLsPath()` 期望的 `server/` 目录结构一致。

---

## 2. 组件设计

### 2.1 `src/jdt/embedded/jdtlsConstants.ts` — 新建常量文件

```typescript
// 存储路径
JDTLS_STORAGE_DIR = ~/.jdt-lsp-cli/jdtls/

// Eclipse 下载源
ECLIPSE_MILESTONES_URL = 'https://download.eclipse.org/jdtls/milestones/'

// npm 包内置 tar.gz 位置
// 在 prepublishOnly 时下载到项目根目录 jdtls/ 目录
JDTLS_PACKAGE_DIR = path.join(PROJECT_ROOT, 'jdtls')

// 默认锁定版本（构建时使用）
JDTLS_DEFAULT_VERSION = '1.58.0'

// 最小磁盘空间 (MB)
MIN_DISK_SPACE_MB = 500
```

### 2.2 `src/jdt/embedded/jdtlsManager.ts` — 新建 JDT LS 管理器

```
class EmbeddedJdtlsManager:
  // 公共 API
  ensure(): Promise<JdtlsInfo>         // 主入口
  getStatus(): Promise<JdtlsStatus>    // 获取状态
  remove(): Promise<void>              // 删除内嵌 JDT LS
  update(): Promise<JdtlsInfo>         // jls jdt update
  getLatestVersion(): Promise<string>  // 从 Eclipse 解析最新版本号

  // 内部方法
  extractFromPackage(): Promise<void>  // 解压 npm 包内置 tar.gz
  downloadJdtls(version): Promise<JdtlsInfo>  // 从 Eclipse 下载
  verifyChecksum(file, sha256Url): Promise<boolean>
  getCachedJdtls(): JdtlsInfo | null
```

**ensure() 流程:**
1. 检查 `~/.jdt-lsp-cli/jdtls/<version>/` 是否存在且有效
2. 存在 → 返回路径
3. 不存在 → 检查 npm 包内置 tar.gz → 解压
4. 解压失败 → 尝试从 Eclipse 下载
5. 下载失败 → 降级处理

**JdtlsInfo 接口:**
```typescript
interface JdtlsInfo {
  path: string;           // JDT LS 根目录
  version: string;        // 如 '1.58.0'
  source: 'embedded' | 'redhat' | 'manual';
  launcherJar: string;    // launcher jar 路径
  size: string;           // 可读大小
  ready: boolean;
}
```

### 2.3 `src/jdt/launcher.ts` — 修改

**修改 `findJdtLsPath()` 优先级:**
1. 用户指定 `--jdtls-path` → 直接使用
2. 内嵌 `~/.jdt-lsp-cli/jdtls/<version>/` → 使用
3. VS Code 扩展 `redhat.java-*` 存在 → 向用户提示是否复用
4. 都不行 → 抛出错误 + 手动下载指引（显示 URL 和目标目录）

**新增 `initJdtls()` 方法:**
```typescript
private async initJdtls(): Promise<void> {
  const jdtlsManager = getJdtlsManager();
  const jdtlsInfo = await jdtlsManager.ensure();
  this.jdtlsPath = jdtlsInfo.path;
}
```

### 2.4 `src/cli/commands/jdt.ts` — 新建 CLI 命令

```
jls jdt status    → 显示 JDT LS 状态
jls jdt update    → 从 Eclipse 下载最新版并替换
jls jdt remove    → 删除内嵌 JDT LS，回退到其他源
```

### 2.5 npm scripts — `scripts/download-jdtls.js` 和 `scripts/extract-jdtls.js`

**`scripts/download-jdtls.js`**（`prepublishOnly` 时调用）:
- 读取 `JDTLS_DEFAULT_VERSION`
- 下载 `jdt-language-server-{version}-{timestamp}.tar.gz` 到项目 `jdtls/` 目录
- 下载并保存 `.sha256` 文件
- 失败时打印错误并 exit(1)

**`scripts/extract-jdtls.js`**（`postinstall` 时调用）:
- 查找 npm 包中 `jdtls/` 目录下的 tar.gz
- 使用系统 `tar -xzf` 解压到 `~/.jdt-lsp-cli/jdtls/<version>/`（Windows 10 17063+/macOS/Linux 均内置 tar）
- 失败时打印手动指引
- 成功后验证 `plugins/org.eclipse.equinox.launcher_*.jar` 存在

---

## 3. 数据流

### 3.1 构建时（维护者）

```
npm run prepublishOnly
  └─ node scripts/download-jdtls.js
       ├─ 解析 https://download.eclipse.org/jdtls/milestones/ 获取最新版本
       ├─ 下载 tar.gz → jdtls/jdt-language-server-{version}-{timestamp}.tar.gz
       ├─ 下载 sha256 → jdtls/jdt-language-server-{version}-{timestamp}.tar.gz.sha256
       └─ 写入 jdtls/version.json (记录版本号)
```

### 3.2 安装时（用户）

```
npm install jdt-lsp-cli
  └─ postinstall: node scripts/extract-jdtls.js
       ├─ 查找 jdtls/*.tar.gz
       ├─ tar -xzf 解压到 ~/.jdt-lsp-cli/jdtls/{version}/
       ├─ 成功 → done
       └─ 失败 → 打印:
            ┌──────────────────────────────────────────────┐
            │ ⚠ JDT LS 解压失败                            │
            │                                              │
            │ 请手动下载 JDT LS:                            │
            │ 下载: https://download.eclipse.org/jdtls/...  │
            │ 解压到: ~/.jdt-lsp-cli/jdtls/{version}/      │
            │                                              │
            │ 或运行 jls jdt install 自动下载              │
            └──────────────────────────────────────────────┘
```

### 3.3 运行时（每次 jls 命令）

```
jls <command>
  └─ JdtLauncher.launch()
       ├─ this.jdtlsPath 已设置（用户指定 --jdtls-path）→ 跳过
       └─ initJdtls()
            └─ EmbeddedJdtlsManager.ensure()
                 ├─ 缓存命中 → 返回
                 ├─ npm tar.gz 存在 → 解压 → 返回
                 ├─ tar.gz 不存在 → 尝试从 Eclipse 下载
                 │    ├─ 成功 → 返回
                 │    └─ 失败 → 降级
                 │         ├─ VS Code 扩展存在 → 询问复用
                 │         │    ├─ 用户同意 → 使用
                 │         │    └─ 用户拒绝 → 错误 + 指引
                 │         └─ 都不行 → 错误 + 指引
                 └─ 返回 JdtlsInfo
```

### 3.4 更新时（用户手动触发）

```
jls jdt update
  └─ EmbeddedJdtlsManager.update()
       ├─ 解析 Eclipse milestones HTML → 获取最新版本号
       ├─ 对比本地版本
       ├─ 版本相同 → "已是最新版本"
       ├─ 有新版本 → 下载 + 校验 + 解压
       └─ 成功 → 更新符号链接 latest → 新版本目录
```

---

## 4. 优先级与降级策略

| 优先级 | 来源 | 行为 |
|--------|------|------|
| 1 | `--jdtls-path` 用户指定 | 直接使用，不做检查 |
| 2 | `~/.jdt-lsp-cli/jdtls/<version>/` 内嵌 | 自动使用 |
| 3 | VS Code `redhat.java-*` 扩展 | 询问用户是否复用 |
| 4 | 全部不可用 | 错误 + 手动下载指引 |

---

## 5. 错误处理

| 场景 | 处理 |
|------|------|
| npm 包未内置 tar.gz | postinstall 跳过解压，运行时尝试从 Eclipse 下载 |
| postinstall 解压失败 | 打印手动指引，不阻塞安装 |
| 磁盘空间不足 | 检测后打印警告，跳过解压 |
| Eclipse 下载超时/失败 | 降级到下一优先级 |
| SHA256 校验失败 | 删除已下载文件，重新尝试或降级 |
| tar.gz 结构无效 | 删除解压目录，报告错误 |

---

## 6. 与现有代码的关系

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/jdt/embedded/jdtlsConstants.ts` | 新建 | 常量定义 |
| `src/jdt/embedded/jdtlsManager.ts` | 新建 | JDT LS 管理器 |
| `src/jdt/launcher.ts` | 修改 | 集成 JdtlsManager，调整优先级 |
| `src/cli/commands/jdt.ts` | 新建 | CLI 命令组 |
| `src/cli/index.ts` | 修改 | 注册 jdt 命令 |
| `scripts/download-jdtls.js` | 新建 | prepublishOnly 脚本 |
| `scripts/extract-jdtls.js` | 新建 | postinstall 脚本 |
| `package.json` | 修改 | 添加 scripts |
| `test/unit/jdt/embedded/jdtlsManager.test.ts` | 新建 | 单元测试 |

---

## 7. 不影响

- JRE 自动下载流程（已独立完成）
- Daemon 启动流程
- 现有 `--jdtls-path` CLI 参数
- VS Code 扩展查找逻辑（降级保留）
- LSP 协议通信层
