# SP02 — 缓存体系与 URI 重写接入（M2）

> 上级：[索引-Jar源码定位主线](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/索引-Jar源码定位主线_f1a2b3c4.md)
> 前置：[SP01-骨架与JDT兜底](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-骨架与JDT兜底_a1b2c3d4.md)
> 原主计划：[Jar类源码定位增强_7a3afe89.md](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/Jar%E7%B1%BB%E6%BA%90%E7%A0%81%E5%AE%9A%E4%BD%8D%E5%A2%9E%E5%BC%BA_7a3afe89.md)
> 对应原 Task：Task 4（全部）+ Task 5.1 / 5.2 / 5.3 + Task 8（部分：positionResolver 修正、`--no-library-resolve`）+ Task 11.2 / 11.7 / 11.8 / 11.9

## 1. 目标

把所有"`!includes('jdt://')` 过滤"改写成"重写为真实 file://"；建立全局主本缓存 + 项目内 symlink/junction 可见性；建立访问追踪与 TTL 清理基础设施。让所有现有命令自动支持 jar 内类。

## 2. 依赖

- 前置 [SP01](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-骨架与JDT兜底_a1b2c3d4.md) 已就绪（`LibraryClassLocator.resolve` 可用）
- 本期的 sources / decompile 分支仍为空实现（由 SP03 / SP04 补入）

## 3. 受影响文件清单

### 3.1 新建

| 路径 | 职责 |
|---|---|
| [src/libraryProvider/cache/globalCache.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/globalCache.ts) | `~/.lsp-cache/global/` 读写 + 文件锁 + 锁等待日志 |
| [src/libraryProvider/cache/workspaceLink.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/workspaceLink.ts) | `.lsp-cache/jars/` symlink/junction/拷贝降级 |
| [src/libraryProvider/cache/accessTracker.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/accessTracker.ts) | 内存 Map + append-only `access.log` 双通道 |
| [src/libraryProvider/cache/cacheCleaner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/cacheCleaner.ts) | 7 天 TTL 清理 + 死链回收 |
| [src/libraryProvider/uriRewriter.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/uriRewriter.ts) | `rewriteLocation` / `rewriteCallItem` / `rewriteLocations` |
| [test/unit/libraryProvider/globalCache.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/globalCache.test.ts) | 含锁并发测试 |
| [test/unit/libraryProvider/workspaceLink.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/workspaceLink.test.ts) | symlink / junction / 拷贝三路径 |
| [test/unit/libraryProvider/accessTracker.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/accessTracker.test.ts) | 双通道 flush + kill -9 恢复模拟 |

### 3.2 修改

| 路径 | 改动摘要 |
|---|---|
| [src/cli/commandHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts) L51 | `if (!target.uri.includes('jdt://'))` → `target = await rewriteCallItem(target)` + 无条件 push（受 `libraryResolveEnabled` 开关保护） |
| [src/cli/commandHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commandHandlers.ts) L296 | 同上 |
| [src/daemon/routes/routeHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts) L443 | 同上 |
| [src/services/navigationService.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/navigationService.ts) L217-231 | `normalizeLocations` 返回前 `await rewriteLocations(result)` |
| [src/services/enhancedCallHierarchy/tree/callTreeBuilder.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/enhancedCallHierarchy/tree/callTreeBuilder.ts) L49-50 / L95 | 过滤 → 重写 |
| [src/services/enhancedCallHierarchy/modes/snapshotModeHandler.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/services/enhancedCallHierarchy/modes/snapshotModeHandler.ts) L73 | 过滤 → 重写 |
| [src/cli/utils/positionResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/utils/positionResolver.ts) L268 | `uri.replace('file://', '')` → `fileURLToPath(uri)`；`jdt://` 分支返回 null 并提示启用 `--library-resolve` |
| [src/core/types.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/core/types.ts) L439-454 | `COMPACT_FIELDS` 增补 `originalUri` / `originalRange` / `source` / `note` / `lockWaitMs` / `lineMapping`；复用 SP01 的 `ResolvedLibraryLocation` |

## 4. 实施步骤

### Task 2.1：全局缓存 globalCache

[cache/globalCache.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/globalCache.ts) 暴露：

```ts
lookup(scope: string, fqcn: string): string | null   // 命中 → 绝对路径，否则 null
write(scope: string, fqcn: string, content: string): Promise<string>
withLock<T>(scope: string, fn: () => Promise<T>): Promise<{ result: T; waitMs: number }>
markFailed(scope: string, reason: string): void
isFailed(scope: string): boolean
```

关键点：

- 目录布局 `~/.lsp-cache/global/{sources|decompiled|jdk|class-file-contents}/<scope>/<pkg>/<Class>.java`
- 锁基元：`fs.mkdirSync(path.join(scopeDir, '.lock'))` 原子失败重试（每 50ms，最长 30s）
- 锁等待追加 `~/.lsp-cache/global/lock-wait.log` 单行：`<isoTimestamp>|<scope>|<waitMs>|<pid>\n`
- `.failed` 标记：`~/.lsp-cache/global/<bucket>/<scope>/.failed`，内容为 `{ reason, ts }` JSON

### Task 2.2：项目内可见性 workspaceLink

[cache/workspaceLink.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/workspaceLink.ts)：

```ts
linkScope(workspaceRoot: string, scope: string, globalScopeDir: string): Promise<{ linkPath: string; mode: 'symlink' | 'junction' | 'copy' }>
ensureGitignore(workspaceRoot: string): void
```

实现细节：

- 目标 `<workspace>/.lsp-cache/jars/<scope>`
- 非 Windows：`fs.symlink(global, link, 'dir')`
- Windows：`fs.symlink(global, link, 'junction')`
- 捕获 `EPERM` / `EACCES` / `ENOSYS` → 走拷贝降级（`fs.cp` recursive），并写入 [capsDetector](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/capsDetector.ts) `supportsSymlink: false`
- 首次降级时写入 `DaemonStateManager.warnings`（由 SP05 消费；本期只保留回调挂载点）
- `.gitignore` 追加 `/.lsp-cache/`（若尚未存在）；用 `os.EOL` + `\r?\n` split 处理跨平台

### Task 2.3：访问追踪 accessTracker

[cache/accessTracker.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/accessTracker.ts)：

```ts
touch(scope: string): void              // 主：memMap; 附：appendFile access.log
flush(): Promise<void>                   // 1min 周期把 memMap 写到各 scope/.lastaccess
getMaxTimestamp(scope: string): Promise<number>   // 清理决策源
compact(): Promise<void>                 // 去重压缩 access.log
```

- 单行日志固定格式 `<unixMs>|<scope>\n`，长度 < 200 字节，保证 Windows/Mac 并发 append 原子
- 启动时回放 `access.log` 重建 memMap

### Task 2.4：缓存清理 cacheCleaner

[cache/cacheCleaner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/cacheCleaner.ts) 暴露 `cleanStale(ttlDays)` / `cleanAll()`。本期仅提供可调用 API，定时调度由 SP05 接入。

- 遍历各 bucket 下 scope，对比 `getMaxTimestamp(scope)` 与 `Date.now() - ttlDays*86400000`
- 删除过期 scope 目录
- 遍历已知 workspace 的 `.lsp-cache/jars/` 扫死链（readlink 指向不存在则 unlink）
- 清理完成后调用 `accessTracker.compact()`

### Task 2.5：LibraryClassLocator 接入缓存

更新 [core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts)：

1. 解析 URI → 得 scope
2. `globalCache.lookup(scope, fqcn)` 命中 → 直接建链 + `accessTracker.touch(scope)` → 返回
3. 未命中 → `globalCache.withLock(scope, async () => { ...SP01 两分支... })` 记录 `lockWaitMs`
4. 写入完成 → `workspaceLink.linkScope(...)` → `accessTracker.touch(scope)` → 返回
5. `ResolvedLibraryLocation.uri` 使用 workspace link 下的 `file://` 路径，而非全局主本原路径

### Task 2.6：URI 重写层

[uriRewriter.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/uriRewriter.ts)：

```ts
export async function rewriteLocation(loc: Location): Promise<Location>
export async function rewriteCallItem(item: CallHierarchyItem): Promise<CallHierarchyItem>
export async function rewriteLocations(arr: Location[]): Promise<Location[]>
```

- `file://` 开头直接透传（零开销）
- `jdt://` → 调 `LibraryClassLocator.resolve`，失败返回原值并打警告（保留老行为）
- `libraryResolveEnabled=false` 时透传（兼容 `--no-library-resolve`）

### Task 2.7：集成点改写

逐处把"过滤"改为"重写"，模板：

```ts
// before
if (!target.uri.includes('jdt://')) result.push(target);
// after
target = await rewriteCallItem(target);
result.push(target);
```

应用于 3.2 表中的六处集成点。

### Task 2.8：positionResolver 修正

[src/cli/utils/positionResolver.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/utils/positionResolver.ts) L268：

```ts
// before
const filePath = uri.replace('file://', '');
// after
import { fileURLToPath } from 'node:url';
if (uri.startsWith('jdt://')) {
  logger.warn('positionResolver received jdt:// uri; enable library-resolve to support jar classes');
  return null;
}
const filePath = fileURLToPath(uri);
```

### Task 2.9：输出字段扩展

修改 [src/core/types.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/core/types.ts) L439-454 的 `COMPACT_FIELDS`，在 `definition` / `references` / `implementations` / `typeDefinition` / `callHierarchy` 字段列表中追加：`originalUri`、`originalRange`、`source`、`note`、`lockWaitMs`、`lineMapping`。

### Task 2.10：单元测试

- `globalCache.test.ts`：两个并发 `withLock(same scope)` 串行化；`lockWaitMs` 大于 0；失败标记后续走兜底
- `workspaceLink.test.ts`：symlink 正常创建；mock `fs.symlink` 抛 `EPERM` → 拷贝降级；`.gitignore` 幂等追加
- `accessTracker.test.ts`：touch → appendFile；重启后 `getMaxTimestamp` 能读回；compact 去重后仅保留最大时间戳

## 5. 验收标准

1. 已有 E2E（mybatis）全部通过
2. 对 jar 内类 definition 请求，返回 `file:///.../.lsp-cache/jars/...` 真实路径，`source: 'class-file-contents'`（本期 sources/decompile 仍为空实现）
3. `originalUri` / `lockWaitMs` / `lineMapping` 字段出现在 CLI 输出中
4. 关闭 `--no-library-resolve` 后行为回退到 SP01 之前（仍保留 SP01 引入的 jdk-src 能力）
5. Windows 环境下 `.lsp-cache/jars/` 以 junction 或拷贝存在
6. 反复 `kill -9` daemon 后，`cleanStale` 仍能基于 access.log 正确裁决

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| symlink 权限失败 | 拷贝降级 + `capsDetector` 持久化；首次降级写入 `warnings` |
| access.log 无限增长 | 清理后 compact 去重，仅保留每 scope 最大时间戳 |
| 路径大小写（NTFS 不敏感 / ext4 敏感） | 命中用 `fs.existsSync` 而非字符串比较 |
| Windows 并发 append 原子性 | 单行 < 200 字节 |
| uriRewriter 引入新异常路径 | 失败静默返回原 `jdt://`，保证现有用例无回归 |
| `positionResolver` 改动破坏现有 CLI 命令 | 仅 file:// 走 `fileURLToPath`，既有 `file://` 行为等价 |

## 7. 回滚策略

- **新建文件**：删除 `src/libraryProvider/cache/` 与 `src/libraryProvider/uriRewriter.ts` 及对应 test 目录
- **集成点（六处）**：按 `git checkout -- <file>` 还原到 SP01 完成时的状态
- **positionResolver.ts L268**：还原 `uri.replace('file://', '')`
- **core/types.ts**：还原 `COMPACT_FIELDS`
- 还原后 `--library-resolve` 行为退化为 SP01 版本
