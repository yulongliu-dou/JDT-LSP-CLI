# SP04 — Sources 获取与 CLI 配置（M3b）

> 上级：[索引-Jar源码定位主线](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/索引-Jar源码定位主线_f1a2b3c4.md)
> 前置：[SP02-缓存与URI重写](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-缓存与URI重写_b2c3d4e5.md)
> 并行：[SP03-Vineflower反编译](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md)
> 原主计划：[Jar类源码定位增强_7a3afe89.md](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/Jar%E7%B1%BB%E6%BA%90%E7%A0%81%E5%AE%9A%E4%BD%8D%E5%A2%9E%E5%BC%BA_7a3afe89.md)
> 对应原 Task：Task 3 sources 链路 + Task 6（CLI 配置与命令 + 输出字段扩展）+ Task 11.3 / 11.4 / 11.5 / 11.6

## 1. 目标

在三级管道中接入 Maven sources jar 获取通道（优先于反编译），支持 `mvn dependency:sources` 懒下载；为 CLI 暴露缓存管理子命令与全局配置开关，让用户/Agent 可控源码来源、TTL 与开关。

## 2. 依赖

- 前置 [SP02](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-缓存与URI重写_b2c3d4e5.md) 已就绪
- 复用 SP01 的 [platform/childProcessUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/childProcessUtils.ts) / [daemonConfigStore.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/daemonConfigStore.ts)
- 与 SP03 并行（不依赖反编译能力；两者在 `LibraryClassLocator` 中相互独立）

## 3. 受影响文件清单

### 3.1 新建

| 路径 | 职责 |
|---|---|
| [src/libraryProvider/sources/sourceJarProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/sourceJarProvider.ts) | 查 `~/.m2` + 可选 mvn 下载 |
| [src/libraryProvider/sources/mvnRunner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/mvnRunner.ts) | `mvn dependency:sources` 子进程封装 |
| [src/libraryProvider/sources/httpDownloader.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/httpDownloader.ts) | 本期仅接口（预留 `fetch(gav)`） |
| [src/cli/commands/cache.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commands/cache.ts) | `jls cache stats|clean|warm` |
| [test/unit/libraryProvider/mavenDependencyResolver.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/mavenDependencyResolver.test.ts) | `jarToGAV` 完整路径 |
| [test/unit/libraryProvider/sourceJarProvider.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/sourceJarProvider.test.ts) | `~/.m2` 命中/未命中 |
| [test/unit/libraryProvider/mvnRunner.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/mvnRunner.test.ts) | 超时、降级、excludeTransitive |

### 3.2 修改

| 路径 | 改动摘要 |
|---|---|
| [src/libraryProvider/resolvers/mavenDependencyResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/mavenDependencyResolver.ts) | 完善 `jarToGAV`：解析 `.m2/repository` 路径反推 GAV；解析 `<workspace>/pom.xml` `<dependencies>` |
| [src/libraryProvider/core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts) | 在 JDK 快速通道后、decompile 之前插入 sources jar 分支 |
| [src/cli/index.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/index.ts) | 全局选项 `--source-download-mode / --decompiler / --cache-ttl-days / --no-library-resolve`；注册 `cache` 子命令 |

## 4. 实施步骤

### Task 4.1：完善 mavenDependencyResolver

[resolvers/mavenDependencyResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/mavenDependencyResolver.ts)：

```ts
export function jarToGAV(jarPath: string): GAV | null
export async function listDirectDeps(workspaceRoot: string): Promise<GAV[]>
export function resolveLocalRepo(): string
```

- `jarToGAV`：若 jarPath 位于 `<localRepo>/<g>/<a>/<v>/<a>-<v>.jar`，按反斜杠/斜杠分段反推；否则 null
- `resolveLocalRepo`：默认 `~/.m2/repository`；若 `~/.m2/settings.xml` 存在 `<localRepository>` 则解析
- `listDirectDeps`：解析 `<workspaceRoot>/pom.xml` 的直接 `<dependencies>`，跳过 `scope=test|provided`

### Task 4.2：sourceJarProvider

[sources/sourceJarProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/sourceJarProvider.ts)：

```ts
export async function fetchSourceJar(gav: GAV, opts?: { downloadMode?: 'off' | 'mvn' | 'http' }): Promise<string | null>
export async function extractFqcn(sourceJarPath: string, fqcn: string, outDir: string): Promise<string | null>
```

流程：

1. 检查 `<localRepo>/<g>/<a>/<v>/<a>-<v>-sources.jar` 是否存在，命中即返回
2. 否则按 `downloadMode`：
   - `off` → 返回 null
   - `mvn`（默认）→ [mvnRunner.runDependencySources](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/mvnRunner.ts) 拉取（单 artifact）
   - `http` → 调用 [httpDownloader.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/httpDownloader.ts)（本期抛 `NotImplementedError`）
3. `extractFqcn` 用 Node 原生 unzip 解出 `<pkg>/<Class>.java`，写入 outDir，返回路径

### Task 4.3：mvnRunner

[sources/mvnRunner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/sources/mvnRunner.ts)：

```ts
export async function runDependencySources(opts: {
  workspaceRoot: string;
  gavs?: GAV[];             // 单 artifact 模式
  excludeTransitive?: boolean;
  timeoutMs?: number;       // 默认 30s
}): Promise<{ ok: boolean; stderr: string }>
```

关键点：

- 可执行文件：Windows `mvn.cmd`，其他 `mvn`；调 [spawnWithTimeout](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/childProcessUtils.ts)
- 参数单 artifact 模式：`['dependency:sources', '-DincludeGroupIds=<g>', '-DincludeArtifactIds=<a>', '-Dclassifier=sources']`
- 直接依赖批量：`-DexcludeTransitive=true -DincludeScope=compile`
- 预检测：`which mvn` / `where mvn` 失败则抛 `MvnNotFoundError`，让 `sourceJarProvider` 回退到 `downloadMode=off`
- 超时触发 `SIGKILL`；Windows 下 child.kill 不可靠但 30s 超时 + spawnWithTimeout 内部会补 `taskkill /F /T /PID`

### Task 4.4：LibraryClassLocator 接入 sources

更新 [core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts) 流水线：

```ts
// JDK 快速通道（SP01）后、decompile（SP03）前
const gav = mavenDependencyResolver.jarToGAV(jarPath);
if (gav) {
  const sourceJar = await sourceJarProvider.fetchSourceJar(gav, { downloadMode });
  if (sourceJar) {
    const filePath = await sourceJarProvider.extractFqcn(sourceJar, fqcn, globalScopeDir);
    if (filePath) {
      // 写入 workspace link + accessTracker.touch
      return { uri: ..., source: 'sources-jar', lineMapping: 'exact', ... };
    }
  }
}
```

### Task 4.5：CLI 全局选项扩展

修改 [src/cli/index.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/index.ts)，在全局 options 加：

```ts
.option('--source-download-mode <mode>', 'off|mvn|http', 'mvn')
.option('--decompiler <kind>', 'vineflower|jdt|off', 'vineflower')
.option('--cache-ttl-days <n>', 'cache TTL in days (0 = disable)', '7')
.option('--no-library-resolve', 'disable jar class resolution (debug escape hatch)')
```

解析后写入 [daemonConfigStore.save(partial)](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/daemonConfigStore.ts)，保证跨命令可见。

### Task 4.6：cache 子命令

新建 [src/cli/commands/cache.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commands/cache.ts)，参考现有 [daemon.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commands/daemon.ts) 样式：

- `jls cache stats`
  - 统计 `~/.lsp-cache/global/` 总大小、各 bucket 大小、scope 数、最老/最新访问
  - 输出表格（默认）或 JSON（`--format json`）
- `jls cache clean [--stale|--all]`
  - `--stale`：按 `cache-ttl-days` 清
  - `--all`：整个 `~/.lsp-cache/` 清除（保留 `daemon-config.json`）
- `jls cache warm --project <path>`
  - 解析 `<path>/pom.xml` 直接依赖
  - 批量 `mvn dependency:sources -DexcludeTransitive=true`
  - 输出进度

### Task 4.7：输出字段扩展（已由 SP02 完成，此处验证）

确认 [core/types.ts#COMPACT_FIELDS](file:///e:/LSP_Scripy/jdt-lsp-cli/src/core/types.ts#L439-L454) 已在 SP02 中追加 `originalUri / originalRange / source / note / lockWaitMs / lineMapping`，本 SP 只需覆盖使用 `source: 'sources-jar'` 的测试用例。

### Task 4.8：单元测试

- `mavenDependencyResolver.test.ts`：
  - `jarToGAV('~/.m2/repository/org/mybatis/mybatis/3.5.13/mybatis-3.5.13.jar')` 返回 `{ groupId: 'org.mybatis', artifactId: 'mybatis', version: '3.5.13' }`
  - 非 .m2 路径返回 null
- `sourceJarProvider.test.ts`：
  - 命中：mock fs 返回存在 `-sources.jar` → 返回路径
  - 未命中 + `downloadMode=off` → 返回 null
  - 未命中 + `downloadMode=mvn` → mock mvnRunner 成功后再命中
- `mvnRunner.test.ts`：
  - mvn 不存在 → `MvnNotFoundError`
  - 超时（mock 长进程）→ 返回 `ok:false`，stderr 含 timeout

## 5. 验收标准

1. Maven 项目依赖类 definition 返回 `source: 'sources-jar'`，`lineMapping: 'exact'`
2. `jls cache stats` 输出合理的表格（含全局大小、scope 数、各 bucket 分类）
3. `jls cache clean --stale --cache-ttl-days 0` 不删除任何 scope
4. `jls cache warm --project <mybatis>` 能成功拉起 mvn，失败 artifact 记录 `.failed`
5. `--source-download-mode off` 下 sources 分支被跳过，流水线直接走 decompile 或 classFileContents
6. `--no-library-resolve` 下 SP02 的 uriRewriter 透传，`jdt://` 维持旧过滤行为
7. 所有新增单元测试通过

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 用户无 mvn | 预检测 + 降级 `downloadMode=off`，打日志提示 |
| mvn 拉取慢 | 30s 超时 + `.failed` 标记避免反复重试 |
| `~/.m2/settings.xml` 自定义仓库路径 | `resolveLocalRepo` 解析 XML |
| UNC 路径 / 带空格路径 | 统一 `path.normalize` + `spawn` args 数组 |
| 单 artifact 调 mvn JVM 启动开销 | warmup 场景批量调用（SP05 做） |
| sources jar 不含所需 fqcn（如 relocation） | `extractFqcn` 返回 null，走 decompile/classFileContents |

## 7. 回滚策略

- **新建文件**：删除 `src/libraryProvider/sources/`、`src/cli/commands/cache.ts`、相关 test
- **[mavenDependencyResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/resolvers/mavenDependencyResolver.ts)**：还原到 SP01 版本（仅空壳 `jarToGAV`）
- **[libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts)**：移除 sources jar 分支
- **[cli/index.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/index.ts)**：还原 `.option` 与 `cache` 子命令注册
- 回滚后退化为 SP02 (+ SP03，若已完成) 组合
