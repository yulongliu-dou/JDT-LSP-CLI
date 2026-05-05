# Jar 类源码定位增强方案

## 设计目标

当前项目遇到 jar 中的类时被三处显式代码 `!target.uri.includes('jdt://')` 丢弃（[commandHandlers.ts L51](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts#L51)、[L296](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts#L296)、[routeHandlers.ts L443](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts#L443)），且路径提取处写死 `uri.replace('file://', '')`（[positionResolver.ts L268](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/utils/positionResolver.ts#L268)），同时 LSP 初始化未声明任何 jdt:// contentProvider 能力（[lspConnection.ts L80-L111](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/lspConnection.ts#L80-L111)）。

方案把"丢弃 jdt://"改为"把 jdt:// 解析成真实 file:// 缓存路径"，所有下游命令无须改写业务逻辑即可自然支持 jar 内类。

## 整体架构（三级管道）

```
  LSP 返回 jdt://contents/<jar>/<fqcn>.class?=...
            │
            ▼
  LibraryClassLocator.resolve(uri)
     ├─ 0) JdkSourceProvider          jrt-fs.jar / java.* → 直取 $JAVA_HOME/lib/src.zip
     ├─ 1) SourceJarProvider          命中 → 解压 sources jar（含 mvn 懒下载）
     ├─ 2) DecompileProvider          Vineflower 反编译 .class
     └─ 3) ClassFileContentsProvider  JDT 原生文本兜底
            │
            ▼
  全局主本 ~/.lsp-cache/global/{sources|decompiled|jdk}/<scope>/<fqcn>.java
            │
            ▼
  项目内链接 <workspace>/.lsp-cache/jars/<scope>/  (symlink/junction，失败降级为拷贝)
            │
            ▼
  重写 Location.uri → file:///<workspace>/.lsp-cache/jars/.../Foo.java
  行号映射（源码 / JDK src.zip 直接用，反编译用 lineMap 尽力而为）
```

## 实现目标文件夹与文件清单（全景）

### A. 新建目录与文件

```
src/libraryProvider/                          # 本次新增的核心模块
├── core/
│   ├── libraryClassLocator.ts
│   ├── jdtUriParser.ts
│   └── types.ts
├── resolvers/
│   ├── dependencyResolver.ts                # interface（扩展点）
│   ├── mavenDependencyResolver.ts
│   ├── jdkRuntimeDetector.ts
│   └── index.ts
├── sources/
│   ├── jdkSourceProvider.ts
│   ├── sourceJarProvider.ts
│   ├── mvnRunner.ts
│   └── httpDownloader.ts                    # 本期仅接口
├── decompile/
│   ├── decompileProvider.ts
│   ├── vineflowerRunner.ts
│   └── lineMap.ts
├── fallback/
│   └── classFileContentsProvider.ts
├── cache/
│   ├── globalCache.ts
│   ├── workspaceLink.ts
│   ├── accessTracker.ts
│   └── cacheCleaner.ts
├── platform/                                # Task 11 跨平台工具集中处
│   ├── pathUtils.ts                         # pathToFileURL/fileURLToPath 封装
│   ├── childProcessUtils.ts                 # mvn.cmd/java 子进程封装
│   └── capsDetector.ts                      # platform-caps.json 探测与缓存
├── uriRewriter.ts                           # Location/CallHierarchyItem 重写入口
├── daemonConfigStore.ts                     # ~/.lsp-cache/daemon-config.json 读写
└── config.ts

src/cli/commands/
└── cache.ts                                 # 新增：jls cache stats|clean|warm

vendor/
└── vineflower-<ver>.jar                     # 内置反编译器（package.json#files 纳入）

test/unit/libraryProvider/
├── jdtUriParser.test.ts
├── mavenDependencyResolver.test.ts
├── jdkRuntimeDetector.test.ts
├── jdkSourceProvider.test.ts
├── lineMap.test.ts
├── accessTracker.test.ts
├── globalCache.test.ts
└── workspaceLink.test.ts

test/e2e/scenarios/mybatis/
└── libraryDefinition.test.ts                # 新增 E2E

docs/commands/
└── library-缓存与源码定位.md                # 新增
```

### B. 需要修改的既有文件

| 文件 | 改动摘要 |
|---|---|
| [src/jdt/lspConnection.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/lspConnection.ts) | `initializationOptions.extendedClientCapabilities.classFileContentsSupport=true`；新增 `getClassFileContents()` |
| [src/jdt/client.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/client.ts) | 暴露 `getClassFileContents` 给服务层 |
| [src/cli/commandHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts) | L51 / L296 `!includes('jdt://')` 过滤 → 改为 `rewriteCallItem` |
| [src/daemon/routes/routeHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts) | L443 同上；新增 `/cache/stats /cache/clean /library/resolve /config` 路由 |
| [src/services/navigationService.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/navigationService.ts) | `normalizeLocations` 返回前 `rewriteLocations` |
| [src/services/enhancedCallHierarchy/tree/callTreeBuilder.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/enhancedCallHierarchy/tree/callTreeBuilder.ts) | L49-50 / L95 过滤改为重写 |
| [src/services/enhancedCallHierarchy/modes/snapshotModeHandler.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/enhancedCallHierarchy/modes/snapshotModeHandler.ts) | L73 过滤改为重写 |
| [src/cli/utils/positionResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/utils/positionResolver.ts) | L268 手拼路径改 `fileURLToPath`；增加 jdt:// 防御分支 |
| [src/cli/index.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/index.ts) | 全局选项加 `--source-download-mode / --decompiler / --cache-ttl-days / --no-library-resolve`；注册 `cache` 子命令 |
| [src/core/types.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/core/types.ts) | `COMPACT_FIELDS` 加 `originalUri/originalRange/source/note/lockWaitMs/lineMapping`；新增 `ResolvedLibraryLocation` 类型 |
| [src/daemon/core/daemonStateManager.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/core/daemonStateManager.ts) | 持有 `LibraryClassLocator` 单例与 `warnings` 字段 |
| [src/daemon/services/projectService.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/services/projectService.ts) | `doInitClient` 末尾挂载 warmup 异步任务 |
| [package.json](file:///e:/LSP_Scripy/jdt-lsp-cli/package.json) | `files` 加 `vendor/`；按需引入 `unzipper` 等依赖 |
| [test/helpers/testUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/helpers/testUtils.ts) | 新增平台 skip 辅助、JAVA_HOME 探测辅助 |
| [docs/全局选项.md](file:///e:/LSP_Scripy/jdt-lsp-cli/docs/全局选项.md) | 新增全局选项说明 |
| [README.md](file:///e:/LSP_Scripy/jdt-lsp-cli/README.md) | 功能矩阵更新 |

### C. 产生的运行时目录（非代码）

```
~/.lsp-cache/
├── global/
│   ├── sources/<g>/<a>/<v>/...
│   ├── decompiled/<g>/<a>/<v>/...
│   ├── jdk/<javaMajor>/<module>/...
│   ├── access.log
│   └── lock-wait.log
├── daemon-config.json
└── platform-caps.json

<workspace>/.lsp-cache/
└── jars/<scope>/...          # symlink/junction 或拷贝
```

## Task 1：新模块骨架 `src/libraryProvider/`

新建目录树（命名与现有 `symbolResolver/` 对齐）：

```
src/libraryProvider/
├── core/
│   ├── libraryClassLocator.ts      # 入口：resolve(jdtUri) → { filePath, line, col }
│   ├── jdtUriParser.ts             # 解析 jdt://contents/<container>/<pkg>.<Class>.class?...
│   └── types.ts                    # GAV、ResolveResult、Provider 接口
├── resolvers/
│   ├── dependencyResolver.ts       # interface DependencyResolver（预留扩展点）
│   ├── mavenDependencyResolver.ts  # 实现：从 pom.xml / .classpath 解析 GAV，映射 jar → GAV
│   ├── jdkRuntimeDetector.ts       # 检测 jrt-fs.jar / java.*/jdk.* 模块，输出 { module, fqcn }
│   └── index.ts                    # 注册表（未来加 Gradle/Classpath 直读只需插入新实现）
├── sources/
│   ├── jdkSourceProvider.ts        # 最高优先级：$JAVA_HOME/lib/src.zip 按模块提取
│   ├── sourceJarProvider.ts        # Maven 源码：查 ~/.m2 + 可选 mvn/http 下载
│   ├── mvnRunner.ts                # mvn dependency:sources 子进程封装（支持 -DexcludeTransitive）
│   └── httpDownloader.ts           # 预留（本期只暴露接口）
├── decompile/
│   ├── decompileProvider.ts        # Vineflower 调用入口
│   ├── vineflowerRunner.ts         # java -jar vineflower.jar <in> <out>
│   └── lineMap.ts                  # 反编译产物 ↔ 字节码行号映射（尽力而为）
├── fallback/
│   └── classFileContentsProvider.ts # 走 JDT LSP java/classFileContents 扩展请求
├── cache/
│   ├── globalCache.ts              # ~/.lsp-cache/global/ 读写 + 文件锁 + 锁等待事件
│   ├── workspaceLink.ts            # .lsp-cache/jars/ symlink/junction 管理（跨平台）+ 降级通知
│   ├── accessTracker.ts            # 内存 Map + append-only access.log + 定期 compact
│   └── cacheCleaner.ts             # 7 天 TTL 清理（读 access.log 最大时间戳）+ 死链回收
├── daemonConfigStore.ts            # ~/.lsp-cache/daemon-config.json 读写（跨请求/命令共享配置）
└── config.ts                       # sourceDownloadMode、cacheTtlDays、decompiler 开关
```

**第三方 jar 内置**：`vendor/vineflower-<ver>.jar` 放在项目根，首次启动时拷贝/引用，不通过 npm 装。`package.json` 的 `files` 字段加入 `vendor/`。

## Task 2：LSP 层 jdt:// 支持

### 2.1 声明 classFileContentsSupport

修改 [lspConnection.ts#initialize](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/lspConnection.ts#L80-L111)，在 `initParams` 加入：

```ts
initializationOptions: {
  extendedClientCapabilities: {
    classFileContentsSupport: true,    // 告诉 JDT LS 可以返回 jdt:// 且客户端能取内容
    overrideTypeDefinition: true,
  },
},
```

### 2.2 新增 classFileContents 请求

在 `LspConnectionManager` 加入：

```ts
async getClassFileContents(uri: string): Promise<string> {
  return this.connection.sendRequest('java/classFileContents', { uri });
}
```

供 fallback 兜底使用。不改任何现有请求签名。

## Task 3：核心入口 `LibraryClassLocator`

```ts
// 输入：LSP 返回的任意 Location/CallHierarchyItem.uri + 原始 range
// 输出：{ uri, range, source, originalUri, originalRange, note?, lockWaitMs? }
//       或 null 表示非 jdt://，维持原样
resolve(uri: string, range: Range): Promise<ResolvedLibraryLocation | null>
```

内部流水线（新增 JDK 快速通道为 Step 1.5）：

1. `jdtUriParser.parse(uri)` → `{ container, fqcn }`
1.5. **JDK 快速通道**：`jdtkRuntimeDetector.isJdkContainer(container)` 为真（jrt-fs.jar / java.*/jdk.* 模块）→
   - `jdkSourceProvider.fetch({ javaHome, module, fqcn })` 从 `$JAVA_HOME/lib/src.zip`（或 JDK 9+ 的 `lib/src.zip` 模块化布局）提取到 `~/.lsp-cache/global/jdk/<javaMajor>/<module>/<fqcn>.java`
   - 直接跳到步骤 5（JDK 源码行号与字节码对齐，无需 lineMap）
2. `mavenDependencyResolver.jarToGAV(jarPath)` → `{ groupId, artifactId, version }`
3. `globalCache.lookup(gav, fqcn)`：
   - 命中 sources → 直接返回 file path + 原行号（`source: 'sources-jar'`）
   - 命中 decompiled → 返回 file path + `lineMap.translate(range)`（`source: 'decompiled'`，附 note）
4. 未命中，按策略链申请产出（受锁保护，锁等待时间记入 `lockWaitMs`）：
   - `sourceJarProvider.fetch(gav)`（策略受 `sourceDownloadMode`: `off|mvn|http` 控制，默认 `mvn`，超时 30s）
   - 失败/缺失 → `decompileProvider.decompile(jarPath, fqcn)`（Vineflower）
   - 失败 → `classFileContentsProvider.get(uri)` 写入 `<fqcn>.java` 兜底（`source: 'class-file-contents'`）
5. 写入全局主本 + 在当前项目 `.lsp-cache/jars/...` 建立 symlink/junction（失败降级为拷贝并触发通知）
6. `accessTracker.touch(scope)` — 同时更新内存 Map 与 append `access.log`
7. 返回结构化结果：
   ```ts
   {
     uri: 'file:///.../Foo.java',
     range: mappedRange,
     source: 'jdk-src' | 'sources-jar' | 'decompiled' | 'class-file-contents',
     originalUri: 'jdt://...',
     originalRange: range,
     note?: 'Decompiled code. Line mapping is approximate. Use method signatures for orientation.',
     lockWaitMs?: 1234,
   }
   ```

## Task 4：Location URI 重写层

新建 `src/libraryProvider/uriRewriter.ts`，提供：

```ts
rewriteLocation(loc: Location): Promise<Location>
rewriteCallItem(item: CallHierarchyItem): Promise<CallHierarchyItem>
rewriteLocations(arr: Location[]): Promise<Location[]>
```

三处集成点（把"过滤 jdt://"改成"重写"）：

- [commandHandlers.ts L51](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts#L51)：`if (!target.uri.includes('jdt://'))` → 先 `target = await rewriteCallItem(target)`，再无条件 push
- [commandHandlers.ts L296](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts#L296)：同上
- [routeHandlers.ts L443](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts#L443)：同上
- [enhancedCallHierarchy/tree/callTreeBuilder.ts L49-L50/L95](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/enhancedCallHierarchy/tree/callTreeBuilder.ts)：同上
- [snapshotModeHandler.ts L73](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/enhancedCallHierarchy/modes/snapshotModeHandler.ts#L73)：同上
- [navigationService.ts normalizeLocations](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/navigationService.ts#L217-L231)：在 `return` 前 `await rewriteLocations(result)`

`uriRewriter` 对 `file://` 开头的 URI 直接透传零开销，保证现有用例无回归。

## Task 5：缓存体系

### 5.1 全局主本 `globalCache`

- 布局 `~/.lsp-cache/global/{sources|decompiled|jdk}/<scope>/<pkg>/<Class>.java`
  - Maven 作用域：`sources|decompiled/<g>/<a>/<v>/...`
  - JDK 作用域：`jdk/<javaMajor>/<module>/...`
- 并发：每个 scope 目录建立 `.lock`（基于原子 `fs.mkdirSync`），首次解压/反编译串行化，后续并发纯读
- **锁等待事件日志**：每次进入等待时在 `~/.lsp-cache/global/lock-wait.log` 追加一行 `timestamp|scope|waitMs|pid`，便于排查 Agent 侧超时；`resolve()` 返回结果中附带本次 `lockWaitMs` 字段
- 下载/反编译失败写 `.failed` 标记 + 原因，后续相同请求直接走兜底链，避免反复重试

### 5.2 项目内可见性 `workspaceLink`

- 路径 `<workspace>/.lsp-cache/jars/<scope>` → symlink to global
- Windows 用 `fs.symlinkSync(target, link, 'junction')`，其余平台 `'dir'`
- 失败降级：创建失败（Windows 无权限等）→ 回退为**拷贝一份**（打日志警告）
- **降级通知**：首次发生降级时，通过 daemon 状态端点 `/status` 的 `warnings` 字段和（如 JDT LS 支持）`window/showMessage` 通知，告知 Agent：
  `"Symbolic links unavailable; falling back to file copies. Extra disk usage may occur."`
  避免 Agent 误判磁盘异常膨胀
- 自动在 `<workspace>/.gitignore` 末尾追加一行 `/.lsp-cache/`（若未存在）

### 5.3 访问追踪 `accessTracker` + 清理 `cacheCleaner`

- **双通道访问追踪**（应对 kill -9 丢失问题）：
  - 主通道：append-only `~/.lsp-cache/global/access.log`，每次 `touch` 立即异步 `fs.appendFile`（格式 `timestamp|scope`），单行 O(几十字节)，开销可忽略
  - 副通道：内存 Map 1 分钟 flush 写入各 scope 目录下的 `.lastaccess`（读路径更快）
  - 清理决策：**以 access.log 中每个 scope 的最大时间戳为准**，`.lastaccess` 仅作读优化
  - 定期 compact：清理后将 access.log 按 scope 去重（仅保留最大时间戳），避免日志无限膨胀
- Daemon 启动延迟 30s 异步清理，周期 12h 再跑一次
- TTL 默认 7 天，支持 `--cache-ttl-days <n>`（0 = 不清理）
- 清理时同步删死链：遍历已知 workspace 的 `.lsp-cache/jars/`
- CLI 暴露 `jls cache clean [--all|--stale]`、`jls cache stats`

## Task 6：CLI 配置与命令

### 6.1 全局选项扩展

在 [src/cli/index.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/index.ts) 的全局 options 加：

- `--source-download-mode <off|mvn|http>`（默认 `mvn`）
- `--decompiler <vineflower|jdt|off>`（默认 `vineflower`）
- `--cache-ttl-days <n>`（默认 `7`）
- `--no-library-resolve`（调试逃生口，保留 jdt:// 过滤旧行为）

### 6.2 新增 `cache` 子命令组

参考现有 [daemon.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commands/daemon.ts) 样式新建 `src/cli/commands/cache.ts`：

- `jls cache stats`：列出全局缓存大小、GAV 数量、最老/最新访问
- `jls cache clean --stale`：按 TTL 清
- `jls cache clean --all`：全清
- `jls cache warm --project <path>`：后台预取该项目所有直接依赖的 sources（懒触发增强）

### 6.3 输出层字段扩展（反编译产物协议强化）

[core/types.ts COMPACT_FIELDS](file:///e:/LSP_Scripy/jdt-lsp-cli/src/core/types.ts#L439-L454)：在 `definition/references/...` 字段列表追加：

- `originalUri`：保留 jdt:// 原值用于调试
- `originalRange`：原始字节码行号区间，便于 Agent 对照
- `source`：`'workspace' | 'jdk-src' | 'sources-jar' | 'decompiled' | 'class-file-contents'`
- `note`（仅反编译路径）：`"Decompiled code. Line mapping is approximate. Use method signatures for orientation. Avoid modifying this file."` — 显式引导 Agent 不要尝试修改反编译文件
- `lockWaitMs`（可选）：本次解析在全局锁上的等待毫秒数
- `lineMapping`：`'exact' | 'best-effort' | 'n/a'`

让 Agent 能分辨返回类别并调整行为（例如反编译文件不发起 rename/edit 建议）。

## Task 7：Daemon 集成

- [daemonStateManager.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/core/daemonStateManager.ts)：持有一个 `LibraryClassLocator` 单例（跨请求复用），随 client 初始化时创建
- **Daemon 配置持久化 `daemonConfigStore`**：daemon 启动时把 `sourceDownloadMode / cacheTtlDays / decompiler / libraryResolveEnabled` 等写入 `~/.lsp-cache/daemon-config.json`；`LibraryClassLocator` 与 `cache` 子命令**统一从该文件读取**，保证通过 HTTP 触发的请求、无头运行、外部 `jls cache warm` 调用看到相同配置
- **后台 warmup（范围受控）**：[projectService.ts#doInitClient](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/services/projectService.ts#L87-L128) 末尾追加异步低优先级任务：
  1. 先解析项目 `pom.xml` 的 `<dependencies>`（只取直接依赖，跳过 test/provided 作用域可配）
  2. 再调 `mvn dependency:sources -DincludeScope=compile -DexcludeTransitive=true`（Maven 3.9+ 的 `maven-dependency-plugin` 支持），一次命令覆盖直接依赖
  3. 老版本 Maven 回退方案：按每批 N 个 artifact 组合 `-DincludeGroupIds=g1,g2 -DincludeArtifactIds=a1,a2` 批量拉取，减少 JVM 启动次数
  4. 不阻塞 `ready` 进度；失败/超时只写 `.failed` 标记，不影响主链路
- [routeHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts) 新增端点：
  - `POST /cache/stats`
  - `POST /cache/clean`
  - `POST /library/resolve` `{ jdtUri }` → 返回重写后的 file://（用于 CLI `cache warm` 等）
  - `POST /config` `{ key, value }` → 运行时改配置并持久化到 `daemon-config.json`

## Task 8：兼容性与降级

- `positionResolver.ts` 的 `uri.replace('file://', '')` 已被重写层保证只见到 file:// 所以无需改动；但加一处防御性判断：若 `uri.startsWith('jdt://')` 直接返回 null 并给 Agent 提示"启用 `--library-resolve`"
- `--no-library-resolve` 下，所有集成点回退到旧的 `jdt://` 过滤逻辑（保留一行 `if (LIBRARY_RESOLVE_ENABLED) target = await rewriteCallItem(target)`）
- 未装 `mvn` 时：`mvnRunner` 预检测并自动降级为 `sourceDownloadMode=off`，日志提示

## Task 9：测试

基于现有 [mybatis-3 fixture](file:///e:/LSP_Scripy/jdt-lsp-cli/test/e2e/fixtures/mybatis-3) 扩展：

- **单元**：`src/libraryProvider/` 每个子模块独立测（jdtUriParser、mavenDependencyResolver、jdkRuntimeDetector、jdkSourceProvider、lineMap、accessTracker 双通道）
- **集成**：mock vineflower 二进制行为，验证四级管道（JDK → sources → decompile → classFileContents）顺序与失败降级；验证 kill -9 后以 access.log 恢复清理决策
- **E2E**：新增 `test/e2e/scenarios/mybatis/libraryDefinition.test.ts`
  - 对 `java.util.function.Function`（JDK 类）：验证 **JdkSourceProvider** 从 `$JAVA_HOME/lib/src.zip` 命中（不走 Maven）
  - 对 Maven 直接依赖类：验证 sources jar 命中
  - 对某第三方依赖（ognl.Ognl）验证反编译兜底及 `note` 字段存在
  - 对 `--no-library-resolve` 验证旧行为不变
  - symlink 失败场景（mock `fs.symlinkSync` 抛错）：验证降级到拷贝 + `warnings` 通知

## Task 10：文档

- 新增 `docs/commands/library-缓存与源码定位.md`
- 更新 `docs/全局选项.md` 加入 `--source-download-mode` 等
- 更新 `README.md` 功能矩阵

## 里程碑拆分（建议提交顺序）

| # | 交付 | 价值 |
|---|---|---|
| M1 | Task 1+2+3 基础骨架 + JDT classFileContents 兜底链路贯通 | 端到端跑通，哪怕只用最低档兜底，jar 内类也不再丢 |
| M2 | Task 4+5 缓存体系 + uriRewriter 接入所有集成点 | 首次"定位到真实 file://"体验 |
| M3 | Task 6 CLI 配置 + Vineflower 主引擎 | 反编译产物质量达标 |
| M4 | Task 5.3 清理 + Task 7 daemon 预取 | 长期运行稳定、首跳体感快 |
| M5 | Task 9 测试 + Task 10 文档 | 可发版 |

## Task 11：跨平台兼容性（Windows / macOS / Linux）

本项目原本就同时面向 Windows 与 Mac 开发环境（参考 [launcher.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 已做的平台分支）。本次新增功能涉及文件系统、子进程、路径等平台敏感点，统一处理策略如下：

### 11.1 路径规范（统一用 Node API，杜绝手拼）

- 所有拼接**必须** `path.join` / `path.resolve`，禁止字符串拼 `/`
- `os.homedir()` 取用户目录（Windows 对应 `%USERPROFILE%`，Mac/Linux 对应 `$HOME`）
- `file://` URI 转换：
  - 生成：`pathToFileURL(absPath).href`（Windows 自动输出 `file:///C:/...`）
  - 解析：`fileURLToPath(uri)`，禁止再用 `uri.replace('file://', '')`
- 修正 [positionResolver.ts#L268](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/utils/positionResolver.ts#L268) 的手拼逻辑，统一走 `url` 模块

### 11.2 Symlink / Junction 跨平台

`workspaceLink.ts` 分支：

| 平台 | 类型 | 权限要求 | 失败降级 |
|---|---|---|---|
| macOS/Linux | `fs.symlink(target, link, 'dir')` | 无需特殊权限 | — |
| Windows 10+ | `fs.symlink(target, link, 'junction')` | 目录 junction 无需管理员 | — |
| Windows 文件级软链 | 需开发者模式或管理员 | 不采用，一律用 junction | — |
| 其他 FS（FAT32/ExFAT 挂载点等） | 不支持链接 | — | **拷贝降级** + `warnings` 通知 |

- 检测顺序：先尝试 junction/symlink → `EPERM|ENOSYS|EACCES` → 走拷贝降级
- 首次降级写入 `~/.lsp-cache/platform-caps.json` 记录当前机器不支持链接，后续项目跳过尝试，直接拷贝
- 拷贝降级后定期（清理时）删除陈旧副本，避免无限膨胀

### 11.3 子进程调用（mvn / java）跨平台

- **mvn**：Windows 下可执行文件名为 `mvn.cmd`；使用 `spawn` 时 `shell: true` 让系统自行解析 PATH；或显式检测 `process.platform === 'win32'` 时使用 `mvn.cmd`
- **java（Vineflower）**：复用 [launcher.ts#javaExecutable](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 的 Java 可执行文件探测逻辑（已处理 `JAVA_HOME/bin/java[.exe]`），不重复造轮子
- 参数含空格/中文路径：统一通过 `spawn` 的 args 数组形式传递，禁止字符串拼接命令
- 结束信号：`child.kill()` 在 Windows 不能可靠传递 SIGTERM，需 `taskkill /F /T /PID`（本期 mvn 子进程只设 30s 超时后 `kill('SIGKILL')`，两平台均可）

### 11.4 JAVA_HOME / src.zip 定位（`jdkSourceProvider`）

- 优先 `process.env.JAVA_HOME`；缺失时复用 `launcher.ts` 已有的探测链
- src.zip 候选路径（按顺序探测）：
  - `$JAVA_HOME/lib/src.zip`（JDK 9+ 标准位置，Windows/Mac/Linux 均同）
  - `$JAVA_HOME/src.zip`（部分 Oracle JDK 安装结构）
  - macOS `/Library/Java/JavaVirtualMachines/<jdk>/Contents/Home/lib/src.zip`（无 JAVA_HOME 时）
- 所有路径判断使用 `fs.existsSync` + `path.join`，不硬编码分隔符
- ZIP 解压统一用 Node 原生 `unzipper` 或依赖 vineflower 运行时的 Java JAR，禁止 `unzip` shell 命令（Windows 默认无此命令）

### 11.5 Maven 本地仓库探测

- 默认路径 `path.join(os.homedir(), '.m2', 'repository')`（两平台一致）
- 若 `~/.m2/settings.xml` 存在自定义 `<localRepository>`，解析之（跨平台都需要）
- Windows 下的 UNC 路径 `\\server\share\.m2`：用 `path.normalize` 后直接走 FS API，Node `fs` 原生支持 UNC

### 11.6 文件锁 `globalCache.lock`

- `fs.mkdirSync(lockDir)` 具有跨平台原子性（POSIX 与 NTFS 均是原子目录创建），作为互斥基元可靠
- 锁超时保护：写入 `.lock/pid` + `mtime`，每 60s 检查，若持锁进程 PID 不存在则强制清锁（Windows 下用 `process.kill(pid, 0)` 的 `ESRCH` 判断）
- **不要**使用 `flock`（Windows 不支持）或 `O_EXLOCK`（跨平台不统一）

### 11.7 访问时间戳 `.lastaccess` 与 `access.log`

- 不依赖文件系统 `atime`（APFS 默认开启但粒度 1s；NTFS 默认关闭；ext4 默认 `relatime`），已通过主通道 `access.log` + 副通道 `.lastaccess` 规避
- `fs.appendFile` 在 Windows 上对同一文件的并发 append 原子性有限；每行 < PIPE_BUF（Windows 约 4KB，Mac 512B），单条日志保持 < 200 字节即可保证原子性，无需额外锁
- 行分隔符统一 `\n`（Node 读取时不区分；避免 Windows 的 `\r\n` 让解析复杂化）

### 11.8 .gitignore 与项目内副本

- `workspaceLink` 写入 `/.lsp-cache/` 时读取现有 `.gitignore`（跨平台一致换行处理：读取后按 `/\r?\n/` 拆分，追加时使用 `os.EOL`）

### 11.9 路径大小写敏感性

- Mac HFS+/APFS 默认大小写**不**敏感；NTFS 默认不敏感；ext4 敏感
- Java FQCN → 文件路径映射严格按包名大小写，缓存命中判断用 `fs.existsSync` 而非字符串比较，避免跨平台歧义

### 11.10 CI / 验证矩阵

- Jest 测试基于平台 skip 机制（项目已有 [test/helpers/testUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/helpers/testUtils.ts) 可扩展）：
  - symlink 降级路径：仅在非 Windows 或 Windows 管理员场景跑，其余 skip
  - JDK src.zip 命中：三平台都跑，用 `JAVA_HOME` 动态定位
  - mvn 调用：若 `which mvn` / `where mvn` 失败则 skip 该条，避免 CI 误报
- 手动验证清单（在 Windows 11 与 macOS 最新 LTS 上各跑一次）：
  1. Mybatis 项目 definition 跳转至 `java.util.function.Function` 返回 `source: 'jdk-src'`
  2. 跳转至 Maven 依赖有 sources 的类返回 `source: 'sources-jar'`
  3. 跳转至无 sources 的类返回 `source: 'decompiled'` + `note`
  4. 项目内 `.lsp-cache/jars/` 在 Mac 是 symlink，在 Windows 是 junction
  5. `jls cache stats` / `jls cache clean` 两平台输出一致

## 关键风险与对策

1. **Windows symlink 权限**：检测到失败→拷贝降级，打警告并通过 `/status.warnings` 暴露给 Agent
2. **jdt:// URI 格式稳定性**：JDT LS 的 `jdt://contents/<container>/<pkg>/<Class>.class?=<jar-hash>` 格式近几年稳定，但仍加版本 sniff，解析失败直接走 fallback
3. **Vineflower 行号对齐**：反编译产物行号与字节码不一致是常态。`lineMap` 采用"尽力匹配"：优先按方法名 + 签名在反编译产物中定位声明行，失败则返回文件开头并给出 `lineMapping: 'best-effort'` 元数据；响应中同时携带 `originalRange` 与 `note` 让 Agent 按方法签名对齐
4. **mvn 调用阻塞**：严格 30s 超时 + 后台预取（只取直接依赖，`excludeTransitive=true`）+ 失败缓存 `.failed` 标记，保证交互路径快速返回
5. **循环依赖/递归反编译**：单次请求内设置 visited set
6. **Daemon 非正常退出访问记录丢失**：采用 append-only `access.log` 主通道 + `.lastaccess` 副通道双写，清理以 log 最大时间戳为准
7. **全局锁等待被 Agent 误判超时**：`resolve()` 返回 `lockWaitMs`，并在 `~/.lsp-cache/global/lock-wait.log` 记录每次等待事件，便于定位
8. **JDK 源码路径差异**：JDK 8 是 `src.zip`（平铺），JDK 9+ 是 `src.zip` 内模块化布局；`jdkSourceProvider` 内部先 sniff ZIP 顶层目录判断形态

## 子计划拆分（承接目录：`.qoder/plans/jar-class-locator/`）

本主计划批准后，会在 `E:\LSP_Scripy\jdt-lsp-cli\.qoder\plans\jar-class-locator\` 新建目录承接以下 6 个子计划。每个子计划独立可 review / 可合并，顺序依赖：SP01 → SP02 → (SP03 ∥ SP04) → SP05 → SP06。

```
.qoder/plans/jar-class-locator/
├── README.md                                    # 子计划索引 + 依赖关系图
├── SP01-skeleton-and-jdt-fallback.md            # M1
├── SP02-cache-and-uri-rewrite.md                # M2
├── SP03-vineflower-decompiler.md                # M3a
├── SP04-sources-and-cli-config.md               # M3b
├── SP05-daemon-integration-and-warmup.md        # M4
└── SP06-test-and-docs.md                        # M5
```

### SP01 — 骨架与 JDT 原生兜底链路（M1）

- **目标**：端到端跑通最低档兜底，jar 内类不再被丢弃
- **交付**：
  - `src/libraryProvider/core/*`、`resolvers/{dependencyResolver,mavenDependencyResolver,jdkRuntimeDetector}.ts`
  - `sources/jdkSourceProvider.ts`（JDK 快速通道）
  - `fallback/classFileContentsProvider.ts`
  - `platform/{pathUtils,childProcessUtils,capsDetector}.ts`
  - `config.ts`、`daemonConfigStore.ts`
  - 修改 `lspConnection.ts`、`client.ts` 声明 `classFileContentsSupport`
  - 单元测试：jdtUriParser / jdkRuntimeDetector / jdkSourceProvider
- **验收**：对 JDK 类可返回 `source: 'jdk-src'`；对任意 jar 类用 fallback 返回 `source: 'class-file-contents'`；CLI 命令不再抛 jdt:// 异常

### SP02 — 缓存体系与 URI 重写接入（M2）

- **目标**：把 jdt:// 重写为真实 file://，所有现有命令自动支持 jar 内类
- **依赖**：SP01 已就绪
- **交付**：
  - `cache/{globalCache,workspaceLink,accessTracker,cacheCleaner}.ts`
  - `uriRewriter.ts`
  - 改写 `commandHandlers.ts` L51/L296、`routeHandlers.ts` L443、`callTreeBuilder.ts` L49/L95、`snapshotModeHandler.ts` L73、`navigationService.ts#normalizeLocations`、`positionResolver.ts` L268
  - `types.ts` 增补字段
  - 单元测试：globalCache（含锁并发）、workspaceLink（symlink/junction/拷贝三路径）、accessTracker 双通道
- **验收**：已有 E2E 全通过；jar 内类 definition 返回 `file://.../.lsp-cache/jars/...` 真实路径且可二次 references / callHierarchy

### SP03 — Vineflower 主引擎（M3a，可与 SP04 并行）

- **目标**：高质量反编译产物
- **依赖**：SP02 已就绪
- **交付**：
  - `decompile/{decompileProvider,vineflowerRunner,lineMap}.ts`
  - `vendor/vineflower-<ver>.jar` 以及 `package.json#files`
  - 单元测试：lineMap（方法签名对齐）、vineflowerRunner（mock Java 子进程）
- **验收**：无 sources 的依赖返回 `source: 'decompiled'` + `note` + `lineMapping: 'best-effort'`

### SP04 — Sources 获取与 CLI 配置（M3b，可与 SP03 并行）

- **目标**：Maven 项目源码优先命中，用户可控
- **依赖**：SP02 已就绪
- **交付**：
  - `sources/{sourceJarProvider,mvnRunner,httpDownloader}.ts`
  - `src/cli/commands/cache.ts`（stats / clean / warm）
  - `src/cli/index.ts` 加全局选项
  - 单元测试：mvnRunner（超时、降级、excludeTransitive）、sourceJarProvider（~/.m2 命中/未命中）
- **验收**：Maven 依赖定位到 `source: 'sources-jar'`；`jls cache stats` / `clean` 可用

### SP05 — Daemon 集成与 Warmup（M4）

- **目标**：长期运行稳定、首跳体感快
- **依赖**：SP03、SP04 均完成
- **交付**：
  - `daemonStateManager.ts` 挂 `LibraryClassLocator` 单例
  - `projectService.ts#doInitClient` 末尾启动 warmup（只取直接依赖，`excludeTransitive=true`）
  - `routeHandlers.ts` 新增 4 个路由
  - 5.3 清理定时器（启动 30s 延迟 + 12h 周期）
  - 集成测试：kill -9 后以 access.log 恢复清理决策
- **验收**：daemon 模式下所有 jar 内操作体感 < 200ms（命中缓存后）；`/status.warnings` 暴露降级信息

### SP06 — 测试与文档（M5）

- **目标**：可发版
- **依赖**：SP05 完成
- **交付**：
  - `test/e2e/scenarios/mybatis/libraryDefinition.test.ts`
  - `test/helpers/testUtils.ts` 平台 skip 扩展
  - `docs/commands/library-缓存与源码定位.md`
  - `docs/全局选项.md` / `README.md` 更新
  - Windows 11 + macOS 手动验证清单跑完
- **验收**：全部 Jest 套件通过；11.10 验证矩阵五项全部勾选

### 子计划之间的约定

- 每个子计划文件内部结构统一为：`目标 / 依赖 / 受影响文件清单 / 实施步骤 / 验收标准 / 风险`
- 子计划内的文件路径引用使用 `file:///e:/LSP_Scripy/jdt-lsp-cli/...` 链接格式，与主计划一致
- 执行阶段按 SP01 → SP02 → (SP03 + SP04) → SP05 → SP06 推进，每完成一个子计划提交一次
- Task 11 跨平台要点**不单独成子计划**，而是散落嵌入到 SP01（pathUtils/capsDetector）、SP02（workspaceLink/accessTracker）、SP04（mvnRunner）、SP06（CI skip + 双平台验证矩阵），避免横切依赖

## 非目标（本期不做）

- Gradle 项目支持（接口已预留 `DependencyResolver`，后续增 `GradleDependencyResolver` 即可）
- 自研 maven HTTP 下载器（接口已预留 `httpDownloader.ts`，默认不启用）
- jar 内类的 rename/refactor（JDT LS 本就不支持编辑只读 classfile）
- 缓存空间上限限额（只按 7 天 TTL，留二期）
- 跨 daemon 进程的分布式锁（本期只处理单机多项目并发，通过 `globalCache.lock` + 锁等待日志保证正确性）
