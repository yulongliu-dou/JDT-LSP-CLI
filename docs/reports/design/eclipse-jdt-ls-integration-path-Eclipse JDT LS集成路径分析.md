# Eclipse JDT Language Server 集成方案

## 背景

jdt-lsp-cli 需要支持两种方式获取 eclipse.jdt.ls：

- **方案 A**：依赖 VS Code Red Hat Java 扩展已安装的 JDT LS（当前实现）
- **方案 B**：从 GitHub / Eclipse 官方源独立下载 JDT LS（待实现）

最终目标：两种方案共存，自动探测，优雅降级。

---

## 总体架构

```
┌─────────────────────────────────────────┐
│           CLI 层 (commander)              │
│  find / symbols / definition / ch / ...  │
├─────────────────────────────────────────┤
│         客户端 / 服务层                     │
│  JdtLsClient + 各类 Service               │
├─────────────────────────────────────────┤
│        LSP 协议连接层                      │
│  LspConnectionManager (vscode-jsonrpc)   │
├─────────────────────────────────────────┤
│       JDT LS 进程管理层                    │
│  JdtLauncher                             │
│  ├── 方案A: VS Code 扩展                  │
│  └── 方案B: 独立下载 (jdtls-manager)      │
├─────────────────────────────────────────┤
│     eclipse.jdt.ls (Java Language Server) │
└─────────────────────────────────────────┘
```

### 核心模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| `JdtLauncher` | `src/jdt/launcher.ts` | 查找 JDT LS 路径、构建 JVM 参数、启动 Java 进程 |
| `LspConnectionManager` | `src/jdt/lspConnection.ts` | LSP stdio 全双工通信 (vscode-jsonrpc) |
| `JdtLsClient` | `src/jdt/client.ts` | 高级 API：文档管理、符号查询等 |
| `ProjectPool` | `src/projectPool.ts` | 多项目 LRU 管理 |
| `EmbeddedJreManager` | `src/jdt/embedded/jreManager.ts` | JRE 下载管理（框架已建，逻辑 TODO） |

---

## 方案 A：VS Code 扩展路径（当前实现）

### 查找路径

```typescript
findJdtLsPath(): string {
  // 1. 用户通过 --jdtls-path 指定
  // 2. ~/.vscode/extensions/redhat.java-*/
  // 3. ~/.vscode-server/extensions/redhat.java-*/
  // 4. ~/.qoder/extensions/redhat.java-*/
  // 5. $JDTLS_HOME 环境变量
  // 6. /usr/share/java/jdtls
  // 7. /opt/jdtls
}
```

定位到扩展目录后：

1. 查找 `server/plugins/org.eclipse.equinox.launcher_*.jar`
2. 选择平台对应的配置目录：`config_win` / `config_linux` / `config_mac`
3. 查找扩展捆绑的 JRE：`jre/<version>/bin/java`

### 优点

- 用户安装了 VS Code Java 扩展即开即用
- 不需要额外下载，节省磁盘空间
- 版本由 VS Code 扩展管理，自动更新

### 缺点

- 依赖 VS Code 扩展，无 VS Code 环境无法使用
- 无法控制 JDT LS 版本
- CI/CD 环境通常无 VS Code

---

## 方案 B：独立下载路径（待实现）

### 下载源

| 源 | URL | 说明 |
|----|-----|------|
| Eclipse 官方下载站点 | `https://download.eclipse.org/jdtls/snapshots/` | 每日构建 |
| GitHub Releases | `https://github.com/eclipse/eclipse.jdt.ls/releases` | 正式发布版 |
| Maven Central | `org.eclipse.jdt.ls:org.eclipse.jdt.ls.product` | Maven 构件 |

### 目录结构（建议）

```
~/.jdt-lsp-cli/
├── jdtls/
│   ├── 1.32.0/
│   │   ├── plugins/
│   │   ├── config_win/
│   │   ├── config_linux/
│   │   └── config_mac/
│   ├── 1.33.0/
│   └── current -> 1.33.0      # 符号链接指向当前版本
├── jre/
│   ├── jdk-21.0.2/
│   └── jdk-17.0.10/
├── data/                       # Project data (索引缓存)
│   ├── base64_project_path_1/
│   └── base64_project_path_2/
└── config.json                 # daemon 配置
```

### 版本管理

```
JdtlsManager
├── listVersions()              # 列出所有已下载版本
├── installVersion(version)     # 下载并解压指定版本
├── removeVersion(version)      # 删除指定版本
├── switchVersion(version)      # 切换当前使用的版本
├── getLatestVersion()          # 从 GitHub API 获取最新版本号
├── getInstalledPath()          # 获取当前版本的安装路径
└── checkForUpdates()           # 检查是否有新版本
```

### JRE 管理

`EmbeddedJreManager` 的 `downloadJre()` 需要从 Adoptium API 获取：

```
API: https://api.adoptium.net/v3/assets/feature_releases/{version}/ga
参数: architecture=x64&image_type=jdk&os=windows&vendor=eclipse
```

---

## 方案 A 与方案 B 的本质关系

### 两者同源

**vscode-java 内置的 JDT LS 与上游 eclipse.jdt.ls 用的是同一个核心代码库。** 不是两套独立的实现。

- Red Hat 团队参与了 eclipse.jdt.ls 项目，同时开发 vscode-java 扩展作为验证 JDT LS 实现的载体
- 两者均以 Eclipse Public License v1.0 开源
- vscode-java 以 eclipse.jdt.ls（上游）为核心，Red Hat 在其上做了打包、补丁和扩展协议增强后集成进来

### 核心差异

#### 1. 版本激进程度（最关键的区别）

vscode-java 通常使用依赖于 JDT 前沿特性的 JDT LS 构建版本，实际上是在**发布 Eclipse Platform/JDT 的预发布版本**，时间线比 Eclipse 官方更激进。

- vscode-java 打包的 JDT LS 往往比从 `download.eclipse.org` 下到的稳定版/里程碑版更新
- 包含还没正式发布的 Eclipse JDT 特性
- 上游稳定版追求稳定，更新节奏保守

#### 2. 额外的专有协议扩展

vscode-java 在标准 LSP 协议基础上加了大量 Red Hat/Microsoft 自定义的扩展命令：

| 扩展能力 | 说明 |
|---------|------|
| Lombok 支持 | 通过 `java.jdt.ls.lombokSupport.enabled` 控制 |
| 双客户端架构 | Standard Client + Syntax Client，实现轻量模式 |
| Maven/Gradle 深度集成 | m2e + Buildship 构建工具链 |
| 扩展间协调 | 与 Java Debugger、Test Runner 等扩展通信 |
| 自定义命令集 | `java.*` 系列扩展命令 |

上游 `eclipse.jdt.ls` 本身没有这些客户端侧的整合，只提供裸语言服务器。

#### 3. 实验性 javac 支持（最前沿特性）

从 vscode-java 1.36.0 起，加入**基于 javac 编译器的实验性支持**，这是目前最重要的差异化特性：

- 与使用 Eclipse JDT 的 ECJ 编译器不同，改用 javac
- 保留所有语言服务器特性
- 由 Red Hat 和 Microsoft 联合推进
- 目标：更贴近 javac 规范，更快支持新 Java 版本，减少 JDT/JDT-LS 团队的维护负担
- 相关工作最终会回贡献到上游 JDT

上游 `eclipse.jdt.ls` 的稳定版目前还没有这个特性。

#### 4. 打包形式对比

| 方面 | vscode-java 内置 JDT LS（方案 A） | 上游 eclipse.jdt.ls（方案 B） |
|------|------|------|
| 获取方式 | 随扩展自动安装 | 手动下载/构建 |
| 内嵌 JRE | 含平台特定版本嵌入式 JRE | 不含 |
| 客户端集成 | 高度集成 VS Code 生态 | 编辑器无关，需自行配置 |
| 更新节奏 | 跟随 vscode-java 发版 | 独立里程碑/快照发版 |

### 谁更强、谁更先进？

- **功能特性维度：vscode-java 内置版更先进**。调试器特性远超独立 JDT-LS 客户端，VS Code Java 在可见的未来会保持领先。
- **编辑器无关维度：上游 eclipse.jdt.ls 更通用**。如果你用 Neovim、Emacs、Helix 等编辑器，直接用上游版本即可，设计目标就是编辑器无关，功能完整覆盖标准 LSP 需求。
- **VS Code/Cursor 用户**：vscode-java 内置版无论是特性前沿程度、集成深度还是工具链配套都是更好的选择，且无需手动管理。

### 一句话总结

两者核心相同，但 vscode-java 内置版是**"加强定制版"**：跑的是更激进的预发布 JDT 构建，叠加了 Red Hat/Microsoft 的额外补丁和 VS Code 专属协议扩展（包括实验性 javac 支持），特性领先上游稳定版数周到数月。上游 `eclipse.jdt.ls` 则是稳定、通用、编辑器无关的基础实现。

---

## 自动探测策略

综合考虑两方案的本质关系后，采用以下探测链：

```
resolveJdtLsPath():
  ├── 1. 用户指定路径 --jdtls-path
  │     → 直接使用（最高优先级）
  │
  ├── 2. VS Code 扩展（方案 A）
  │     → 探测 ~/.vscode/extensions/redhat.java-*/
  │     → 自动发现捆绑 JRE
  │     → 优势：预发布特性、嵌入式 JRE、零配置
  │
  ├── 3. 独立安装（方案 B）
  │     → 探测 ~/.jdt-lsp-cli/jdtls/current
  │     → 用于 CI/CD、无 VS Code 环境
  │
  └── 4. 均不可用
        → 报错并提示安装方式
        → 优先推荐安装 VS Code Java 扩展（方案 A 最省事）
        → 无头环境提示使用 `jls jdtls install`（方案 B）
```

---

## LSP 通信细节

### 进程启动参数

```
java
  -Xms256m -Xmx1g
  -XX:+UseG1GC -XX:MaxGCPauseMillis=20 -XX:+UseStringDeduplication
  -Declipse.application=org.eclipse.jdt.ls.core.id1
  -Dosgi.bundles.defaultStartLevel=4
  -Declipse.product=org.eclipse.jdt.ls.core.product
  -Dosgi.checkConfiguration=true
  -Dosgi.sharedConfiguration.area={config_dir}
  -Dosgi.sharedConfiguration.area.readOnly=true
  -Dosgi.configuration.cascaded=true
  --add-modules=ALL-SYSTEM
  --add-opens java.base/java.util=ALL-UNNAMED
  --add-opens java.base/java.lang=ALL-UNNAMED
  -jar {launcher_jar}
  -data {data_dir}
```

### 通信方式

| 项目 | 值 |
|------|-----|
| 传输层 | stdio 管道 (stdin/stdout) |
| 序列化 | JSON-RPC |
| 库 | `vscode-jsonrpc` StreamMessageReader / StreamMessageWriter |
| 初始化协议 | Initialize → InitializedNotification |

### 初始化参数

```typescript
// InitializeParams
{
  processId,                         // Node.js 进程 PID
  rootUri: "file:///path/to/project",
  capabilities: {
    textDocument: {
      callHierarchy: { dynamicRegistration: true },
      definition: { linkSupport: true },
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      implementation: { linkSupport: true },
      hover: { contentFormat: ["plaintext", "markdown"] },
    },
    workspace: { workspaceFolders: true },
  },
  initializationOptions: {
    extendedClientCapabilities: {
      classFileContentsSupport: true,   // jdt:// URI 解析
      overrideTypeDefinition: true,
    },
  },
}
```

---

## LSP 能力映射

| CLI 命令 | 别名 | LSP 方法 | 支持的 LSP 能力 |
|----------|------|---------|----------------|
| `find` | `f` | `workspace/symbol` | 跨项目符号搜索 |
| `symbols` | `sym` | `textDocument/documentSymbol` | 文件内符号列表 |
| `definition` | `def` | `textDocument/definition` | 跳转到定义 |
| `references` | `refs` | `textDocument/references` | 查找所有引用 |
| `hover` | | `textDocument/hover` | 悬停信息 / javadoc |
| `call-hierarchy` | `ch` | `textDocument/prepareCallHierarchy` + `callHierarchy/incomingCalls` / `outgoingCalls` | 调用链分析 |
| `implementations` | `impl` | `textDocument/implementation` | 查找实现类 |
| `type-definition` | `typedef` | `textDocument/typeDefinition` | 类型定义跳转 |
| `cache` (jar 类定位) | | `java/classFileContents` (JDT 扩展) | jar 内类源码解析 |

---

## 守护进程模式

### 架构

```
Daemon HTTP Server (port 9876)
  ├── /api/command       → CLI 命令代理到 JDT LS
  ├── /api/config        → 热更新配置
  ├── /api/projects      → 项目池管理
  ├── /api/status        → 守护进程状态
  │
  └── ProjectPool (多项目 LRU 管理)
       ├── Project A (JdtLsClient + Java Process)
       ├── Project B (JdtLsClient + Java Process)
       └── LRU 淘汰策略 + 空闲超时回收
```

### 性能对比

| 模式 | 首次命令 | 后续命令 |
|------|----------|----------|
| 直接模式 | 30-60s (JVM 启动 + 项目索引) | 30-60s |
| 守护进程 | 30-60s (同上) | **5-500ms** |

---

## jar 内类定位管道

当 JDT LS 返回 `jdt://` URI 时，四级解析管道自动获取可读源码：

| 优先级 | 源 | 行号精度 | 触发条件 |
|--------|------|----------|----------|
| 1 | JDK `src.zip` | `exact` | `java.base` 等标准库 |
| 2 | Maven `sources.jar` | `exact` | 项目传递依赖 |
| 3 | Vineflower 反编译 | `best-effort` | 无 sources 的三方 jar |
| 4 | `classFileContents` | n/a | 反编译失败或 class 本身 |

---

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `src/jdt/launcher.ts` | JDT LS 查找与进程启动 |
| `src/jdt/lspConnection.ts` | LSP JSON-RPC 连接管理 |
| `src/jdt/client.ts` | 客户端高级 API 封装 |
| `src/jdt/configLoader.ts` | JVM 与 daemon 配置加载 |
| `src/jdt/embedded/jreManager.ts` | 内嵌 JRE 管理（TODO） |
| `src/projectPool.ts` | 多项目 LRU 池 |
| `src/daemon/services/projectService.ts` | 项目初始化与服务 |
| `src/libraryProvider/` | 源码缓存与 jar 定位管道 |

---

## CLI 用户提示设计（待实现）

用户在调用 jls 命令时，需要根据当前状态给出差异化提示。

### 场景一：JDT LS 未找到

```
$ jls find MyClass
✖ 未找到 Java Language Server

可选的安装方式（推荐按优先级排序）：

  方案 A（推荐）— 安装 VS Code Java 扩展：
    安装 Red Hat Java 扩展后 jls 自动发现，无需额外配置
    → https://marketplace.visualstudio.com/items?itemName=redhat.java

  方案 B（无头环境）— 独立下载 JDT LS：
    jls jdtls install                   # 安装最新稳定版
    jls jdtls install --version 1.33.0  # 指定版本

  提示：jls 优先使用 VS Code 扩展内嵌的 JDT LS（特性更前沿），
  其次才使用独立安装版本。
```

### 场景二：独立安装可用，但 VS Code 扩展版本更新

```
$ jls find MyClass
ℹ 当前使用独立安装的 JDT LS v1.32.0（方案 B）
  VS Code 扩展内含 JDT LS v1.35.0（方案 A），特性更前沿
  → 安装 VS Code Java 扩展以获得最佳体验
```

### 场景三：版本切换/更新

```
$ jls jdtls install --version 1.33.0
✓ 已下载 JDT LS v1.33.0 到 ~/.jdt-lsp-cli/jdtls/1.33.0
  当前版本：1.32.0 → 1.33.0
  注意：VS Code 扩展内嵌版本仍为 1.35.0（不受此操作影响）
  如果你同时安装了 VS Code Java 扩展，jls 优先级上仍会优先使用扩展版本
```

### 场景四：多版本管理

```
$ jls jdtls list
  已安装版本：
    1.32.0 (current)   - 独立安装
    1.30.0             - 独立安装
  VS Code 扩展版本：
    1.35.0             - 来自 redhat.java-1.35.0
```

## 待实现功能清单

### P0 — 核心能力

- [ ] `JdtlsManager` — 从 Eclipse 官方下载站点 / GitHub Releases 下载并管理 JDT LS 版本
- [ ] `EmbeddedJreManager.downloadJre()` — 从 Adoptium API 下载 JRE
- [ ] 自动探测策略（用户指定 → VS Code 扩展 → 独立安装 → 报错提示）
- [ ] `jls jdtls install/update/switch/list` 子命令

### P1 — 增强

- [ ] CI/CD 环境无头安装（`jls jdtls install --version latest --jre 21`）
- [ ] 启动时探测 VS Code 扩展版本 vs 独立安装版本，给出版本比对提示
- [ ] 对方案 A 来源的 JDT LS 标注"来自 VS Code 扩展"（含预发布特性提示）
- [ ] 对方案 B 来源的 JDT LS 标注"独立安装"（含稳定版提示）

### P2 — 优化

- [ ] `jls jdtls check-update` — 检查上游是否有新版本
- [ ] `jls jdtls info` — 显示当前使用的 JDT LS 来源、版本、JRE 版本
- [ ] 无 Java 环境时自动下载 JRE（`EmbeddedJreManager`）
- [ ] 首次运行向导（首次无 JDT LS 时交互式引导安装）
