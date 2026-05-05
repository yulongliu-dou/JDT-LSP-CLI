# SP01 — 骨架与 JDT 原生兜底链路（M1）

> 上级：[索引-Jar源码定位主线](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/索引-Jar源码定位主线_f1a2b3c4.md)
> 原主计划：[Jar类源码定位增强_7a3afe89.md](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/Jar%E7%B1%BB%E6%BA%90%E7%A0%81%E5%AE%9A%E4%BD%8D%E5%A2%9E%E5%BC%BA_7a3afe89.md)
> 对应原 Task：Task 1（骨架部分子集）+ Task 2（LSP 层）+ Task 3（仅 JDK 快速通道与 classFileContents 兜底）+ Task 11.1 / 11.3 部分

## 1. 目标

建立 `src/libraryProvider/` 模块骨架；让 LSP 层声明 `classFileContentsSupport`；实现最小可用的"JDK 源码直取 + JDT 原生 classFileContents 兜底"链路，让 jar 类遇到时不再抛异常。

## 2. 依赖

- 无前置子计划
- 依赖现有 [launcher.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 的 Java 可执行文件探测能力

## 3. 受影响文件清单

### 3.1 新建

| 路径 | 职责 |
|---|---|
| [src/libraryProvider/core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts) | 入口：`resolve(uri, range)` 串联各 Provider |
| [src/libraryProvider/core/jdtUriParser.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/jdtUriParser.ts) | 解析 `jdt://contents/<container>/<pkg>.<Class>.class?=...` |
| [src/libraryProvider/core/types.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/types.ts) | `GAV` / `ResolvedLibraryLocation` / `SourceProvider` 接口 |
| [src/libraryProvider/resolvers/dependencyResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/dependencyResolver.ts) | interface，扩展点 |
| [src/libraryProvider/resolvers/mavenDependencyResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/mavenDependencyResolver.ts) | 本期仅实现 `jarToGAV(jarPath)` 基础版 |
| [src/libraryProvider/resolvers/jdkRuntimeDetector.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/jdkRuntimeDetector.ts) | 检测 jrt-fs.jar / `java.*` / `jdk.*` 模块 |
| [src/libraryProvider/resolvers/index.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/index.ts) | 注册表 |
| [src/libraryProvider/sources/jdkSourceProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/jdkSourceProvider.ts) | 从 `$JAVA_HOME/lib/src.zip` 提取模块源码 |
| [src/libraryProvider/fallback/classFileContentsProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/fallback/classFileContentsProvider.ts) | 调用 `java/classFileContents` 兜底 |
| [src/libraryProvider/platform/pathUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/pathUtils.ts) | `pathToFileURL` / `fileURLToPath` 封装 |
| [src/libraryProvider/platform/childProcessUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/childProcessUtils.ts) | 子进程封装（含 Windows `.cmd` 处理） |
| [src/libraryProvider/platform/capsDetector.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/capsDetector.ts) | `platform-caps.json` 探测与缓存 |
| [src/libraryProvider/config.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/config.ts) | `sourceDownloadMode` / `cacheTtlDays` / `decompiler` / `libraryResolveEnabled` 配置读写 |
| [src/libraryProvider/daemonConfigStore.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/daemonConfigStore.ts) | `~/.lsp-cache/daemon-config.json` 读写 |
| [test/unit/libraryProvider/jdtUriParser.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/jdtUriParser.test.ts) | URI 解析单元测试 |
| [test/unit/libraryProvider/jdkRuntimeDetector.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/jdkRuntimeDetector.test.ts) | JDK 模块识别单元测试 |
| [test/unit/libraryProvider/jdkSourceProvider.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/jdkSourceProvider.test.ts) | src.zip 提取单元测试（按需 mock） |

### 3.2 修改

| 路径 | 改动摘要 |
|---|---|
| [src/jdt/lspConnection.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/lspConnection.ts) L80-111 | `initializationOptions.extendedClientCapabilities.classFileContentsSupport=true`；新增 `getClassFileContents(uri)` 方法 |
| [src/jdt/client.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/client.ts) | 暴露 `getClassFileContents` 给服务层 |

## 4. 实施步骤

### Task 1.1：创建模块骨架目录与空壳文件

按 3.1 节列表创建所有目录与 `.ts` 空壳文件，仅保留 `export {}` 与 JSDoc 头注释，保证 `tsc` 编译通过。

### Task 1.2：定义核心类型

[core/types.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/types.ts) 定义：

```ts
export interface GAV { groupId: string; artifactId: string; version: string; }
export type LibrarySource = 'workspace' | 'jdk-src' | 'sources-jar' | 'decompiled' | 'class-file-contents';
export type LineMapping = 'exact' | 'best-effort' | 'n/a';
export interface ResolvedLibraryLocation {
  uri: string;
  range: import('vscode-languageserver-types').Range;
  source: LibrarySource;
  originalUri: string;
  originalRange: import('vscode-languageserver-types').Range;
  note?: string;
  lockWaitMs?: number;
  lineMapping?: LineMapping;
}
export interface SourceProvider { fetch(ctx: unknown): Promise<string | null>; }
```

### Task 1.3：jdt:// 解析器

[core/jdtUriParser.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/jdtUriParser.ts) 实现 `parse(uri: string): { container: string; fqcn: string } | null`，对非 jdt:// 返回 null，解析失败返回 null。覆盖以下格式：

- `jdt://contents/<container>/<pkg>/<Class>.class?=<hash>`
- `jdt://jarentry/<jar>!/<pkg>/<Class>.class`（防御性，少见）

### Task 1.4：JDK 模块检测

[resolvers/jdkRuntimeDetector.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/jdkRuntimeDetector.ts) 提供 `isJdkContainer(container: string): boolean`。判定规则：

- container 以 `jrt-fs.jar` 结尾
- container 含 `/jre/lib/` 或 `/jmods/`
- fqcn 以 `java.` / `javax.` / `jdk.` / `com.sun.` / `sun.` 开头

### Task 1.5：JDK 源码提供器

[sources/jdkSourceProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/jdkSourceProvider.ts) 实现 `fetch({ fqcn })`：

1. 复用 [launcher.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 的 JAVA_HOME 探测
2. 候选 src.zip 路径按顺序：`$JAVA_HOME/lib/src.zip` → `$JAVA_HOME/src.zip` → macOS `/Library/Java/JavaVirtualMachines/*/Contents/Home/lib/src.zip`
3. 用 Node 原生 `zlib` / `unzipper` 解压，按 fqcn 定位 `<module>/<pkg>/<Class>.java`
4. JDK 9+ 模块化布局 sniff：读 ZIP 顶层目录判断，JDK 8 平铺则直接按 pkg 路径查找
5. 解压到 `~/.lsp-cache/global/jdk/<javaMajor>/<module>/<fqcn>.java`（目录即使尚未存在也要能创建；此时还没有 globalCache 模块，本期直接用 `fs.mkdirSync { recursive: true }`）
6. 返回写入后的绝对路径

### Task 1.6：classFileContents 兜底

[fallback/classFileContentsProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/fallback/classFileContentsProvider.ts) 实现 `get(uri)`：

- 通过注入的 `LspConnectionManager.getClassFileContents(uri)` 获取原文
- 写入 `~/.lsp-cache/global/class-file-contents/<hash>/<fqcn>.java`（hash 为 uri 的 sha1 前 8 位，避免同名冲突）
- 返回写入后的绝对路径

### Task 1.7：核心入口 LibraryClassLocator

[core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts) 本期只实现两个分支（sources jar / decompile 在 SP02 / SP03 补入）：

```ts
async resolve(uri: string, range: Range): Promise<ResolvedLibraryLocation | null> {
  const parsed = jdtUriParser.parse(uri);
  if (!parsed) return null;
  if (jdkRuntimeDetector.isJdkContainer(parsed.container)) {
    const path = await jdkSourceProvider.fetch({ fqcn: parsed.fqcn });
    if (path) return { uri: pathToFileURL(path).href, range, source: 'jdk-src', originalUri: uri, originalRange: range, lineMapping: 'exact' };
  }
  // SP02/03/04 未就绪前直接走兜底
  const path = await classFileContentsProvider.get(uri);
  return { uri: pathToFileURL(path).href, range, source: 'class-file-contents', originalUri: uri, originalRange: range, lineMapping: 'n/a' };
}
```

### Task 1.8：LSP 层声明与新请求

修改 [src/jdt/lspConnection.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/lspConnection.ts) L80-111 的 `initParams`：

```ts
initializationOptions: {
  ...existingOptions,
  extendedClientCapabilities: {
    ...(existingOptions?.extendedClientCapabilities ?? {}),
    classFileContentsSupport: true,
    overrideTypeDefinition: true,
  },
},
```

并新增方法：

```ts
async getClassFileContents(uri: string): Promise<string> {
  return this.connection.sendRequest('java/classFileContents', { uri });
}
```

修改 [src/jdt/client.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/client.ts)：透传 `getClassFileContents`。

### Task 1.9：配置与持久化

- [config.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/config.ts)：维护默认值 `{ sourceDownloadMode: 'mvn', cacheTtlDays: 7, decompiler: 'vineflower', libraryResolveEnabled: true }`
- [daemonConfigStore.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/daemonConfigStore.ts)：`load()` / `save(partial)` 读写 `~/.lsp-cache/daemon-config.json`，原子写（临时文件 + rename）

### Task 1.10：跨平台工具

- [platform/pathUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/pathUtils.ts)：`toFileUrl(p)` / `fromFileUrl(u)` 封装 `url` 模块
- [platform/childProcessUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/childProcessUtils.ts)：`spawnWithTimeout(cmd, args, { timeoutMs, cwd })`，Windows 下 cmd 以 `.cmd` 结尾自动 `shell: true`
- [platform/capsDetector.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/capsDetector.ts)：读写 `~/.lsp-cache/platform-caps.json`，记录 `{ supportsSymlink: boolean, detectedAt: number }`

### Task 1.11：单元测试

- `jdtUriParser.test.ts`：覆盖 jdt:// / file:// / 畸形 URI
- `jdkRuntimeDetector.test.ts`：覆盖 `java.util.List` / `com.mybatis.Foo` / 空 container
- `jdkSourceProvider.test.ts`：mock `fs`，验证 JDK 8 平铺与 JDK 11 模块化两种 ZIP 布局

## 5. 验收标准

1. `tsc` 编译全通过，无 `any` 引入（类型文件除外）
2. 新增单元测试全部通过
3. 对 `java.util.function.Function` 的 jdt:// URI，`LibraryClassLocator.resolve` 返回 `source: 'jdk-src'` 且 `uri` 以 `file://` 开头
4. 对任意非 JDK jar URI 返回 `source: 'class-file-contents'` 且产物文件存在
5. 现有 E2E 测试（mybatis）全部维持绿（本次未接入 uriRewriter，jdt:// 仍被过滤；但已能独立调用 `LibraryClassLocator.resolve`）
6. `~/.lsp-cache/daemon-config.json` 在首次启动时被创建，内容为默认配置

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| JDK 版本差异（8 平铺 vs 9+ 模块化） | `jdkSourceProvider` sniff ZIP 顶层目录决定策略 |
| macOS 无 `JAVA_HOME` | 复用 [launcher.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 的探测链，失败返回 null 走兜底 |
| `java/classFileContents` 超时 | 底层 `sendRequest` 本就有 timeout；上层捕获异常返回 null |
| jdt:// URI 格式少见变体 | 解析失败返回 null，由调用方降级到原 `jdt://` 过滤逻辑 |

## 7. 回滚策略

- **新建文件**：全部删除 `src/libraryProvider/` 目录与 `test/unit/libraryProvider/` 子目录即可
- **修改 [lspConnection.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/lspConnection.ts)**：还原 `extendedClientCapabilities` 到改动前值，删除 `getClassFileContents` 方法
- **修改 [client.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/client.ts)**：删除透传方法
- 还原验证：`git diff` 仅剩原 `Jar类源码定位增强_7a3afe89.md` 未被修改
