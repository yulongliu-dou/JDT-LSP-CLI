# SP05 — Daemon 集成与 Warmup（M4）

> 上级：[索引-Jar源码定位主线](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/索引-Jar源码定位主线_f1a2b3c4.md)
> 前置：[SP03-Vineflower反编译](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md) + [SP04-源码获取与CLI配置](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
> 原主计划：[Jar类源码定位增强_7a3afe89.md](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/Jar%E7%B1%BB%E6%BA%90%E7%A0%81%E5%AE%9A%E4%BD%8D%E5%A2%9E%E5%BC%BA_7a3afe89.md)
> 对应原 Task：Task 7（全部）+ Task 5.3 清理定时器

## 1. 目标

将 `LibraryClassLocator` 以单例形态挂载到 daemon 状态；在项目初始化尾段挂 warmup 异步任务预取直接依赖的 sources；暴露 `/cache/*` / `/library/resolve` / `/config` HTTP 端点；启动定时清理作业。daemon 模式下 jar 内操作体感 < 200ms（命中缓存后）。

## 2. 依赖

- 前置 [SP03](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md) 与 [SP04](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md) 均完成
- 复用 SP01 的 [daemonConfigStore.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/daemonConfigStore.ts)、SP02 的 [cacheCleaner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/cacheCleaner.ts)

## 3. 受影响文件清单

### 3.1 新建

| 路径 | 职责 |
|---|---|
| [test/unit/daemon/libraryLocatorIntegration.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/daemon/libraryLocatorIntegration.test.ts) | 单例复用 + warmup 启动 + 清理定时器 |

### 3.2 修改

| 路径 | 改动摘要 |
|---|---|
| [src/daemon/core/daemonStateManager.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/core/daemonStateManager.ts) | 持有 `LibraryClassLocator` 单例（跨请求复用）；新增 `warnings: string[]` 字段供 symlink 降级等使用 |
| [src/daemon/services/projectService.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/services/projectService.ts) L87-128 | `doInitClient` 末尾挂 warmup 异步任务（不阻塞 ready） |
| [src/daemon/routes/routeHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts) | 新增 4 个路由：`/cache/stats`、`/cache/clean`、`/library/resolve`、`/config`；`/status` 返回 `warnings` |
| [src/daemon-process.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon-process.ts) | 启动 30s 延迟后调 [cacheCleaner.cleanStale](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/cacheCleaner.ts)；`setInterval` 每 12h 再跑一次 |

## 4. 实施步骤

### Task 5.1：daemonStateManager 单例

修改 [daemon/core/daemonStateManager.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/core/daemonStateManager.ts)：

```ts
class DaemonStateManager {
  private libraryLocator?: LibraryClassLocator;
  public warnings: string[] = [];

  getLibraryLocator(): LibraryClassLocator {
    if (!this.libraryLocator) {
      this.libraryLocator = new LibraryClassLocator({
        getClassFileContents: (uri) => this.getClient().getClassFileContents(uri),
        onWarning: (msg) => this.warnings.push(msg),
      });
    }
    return this.libraryLocator;
  }
}
```

确保 `uriRewriter` 在 daemon 模式下从 `DaemonStateManager.getLibraryLocator()` 取实例，避免每次请求重建。

### Task 5.2：warmup 挂载

修改 [daemon/services/projectService.ts#doInitClient](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/services/projectService.ts) L87-128，在最后 `return client` 前追加（不阻塞）：

```ts
queueMicrotask(async () => {
  try {
    const deps = await mavenDependencyResolver.listDirectDeps(workspaceRoot);
    if (deps.length === 0) return;
    // 老版本 Maven 兼容：分批 (每批 N=20) 组合 includeGroupIds/includeArtifactIds
    const batches = chunk(deps, 20);
    for (const batch of batches) {
      await mvnRunner.runDependencySources({
        workspaceRoot,
        gavs: batch,
        excludeTransitive: true,
        timeoutMs: 60_000,
      });
    }
    logger.info(`warmup done: ${deps.length} direct deps`);
  } catch (e) {
    logger.warn('warmup failed, non-fatal', e);
  }
});
```

- 跳过 `test`/`provided` 作用域
- 任一批失败写 `.failed`，不影响主链路
- 提供配置项 `warmupEnabled: true`（默认），`daemon-config.json` 可关

### Task 5.3：routeHandlers 新增端点

修改 [daemon/routes/routeHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts)：

- `POST /cache/stats`
  ```ts
  { totalBytes, buckets: { sources, decompiled, jdk, classFileContents }, scopeCount, oldestAccess, latestAccess }
  ```
- `POST /cache/clean` body `{ mode: 'stale' | 'all', ttlDays?: number }` → 调 [cacheCleaner](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/cache/cacheCleaner.ts)
- `POST /library/resolve` body `{ jdtUri: string, range?: Range }` → `LibraryClassLocator.resolve` 直通，返回 `ResolvedLibraryLocation` 给 CLI `cache warm` 复用
- `POST /config` body `{ key: string, value: unknown }` → 写入 [daemonConfigStore](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/daemonConfigStore.ts) 并 hot-reload

修改 `/status` 返回体加入：

```ts
{
  ...existing,
  warnings: stateManager.warnings.slice(-10),
  libraryResolveEnabled: config.libraryResolveEnabled,
}
```

### Task 5.4：定时清理

修改 [src/daemon-process.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon-process.ts)：

```ts
setTimeout(async () => {
  try {
    await cacheCleaner.cleanStale(config.cacheTtlDays);
  } catch (e) { logger.warn(e); }
  setInterval(() => cacheCleaner.cleanStale(config.cacheTtlDays).catch(logger.warn),
              12 * 60 * 60 * 1000);
}, 30_000);
```

- `cacheTtlDays=0` 时清理函数内部直接 return
- 清理日志落 `~/.lsp-cache/global/cleaner.log`

### Task 5.5：集成测试

[test/unit/daemon/libraryLocatorIntegration.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/daemon/libraryLocatorIntegration.test.ts)：

- 启动一个 mock daemon → 两次 `/library/resolve` 同 URI → 第二次耗时显著下降（命中缓存）
- `/status.warnings` 在 mock symlink 失败后包含降级提示
- `kill -9` 模拟：启动前写入预置的 `access.log` → 启动后 `cleanStale` 能基于 log 裁决

## 5. 验收标准

1. daemon 模式下，同一 `jdt://` URI 第二次 `/definition` 耗时 < 200ms
2. `/status` 返回的 `warnings` 在 symlink 失败场景下包含 `"Symbolic links unavailable; falling back to file copies..."`
3. `/cache/stats` 输出符合 [cache.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/cli/commands/cache.ts) 调用预期
4. warmup 在 mybatis 项目启动 30-60s 内完成直接依赖 sources 拉取，`.lsp-cache/global/sources/` 有预期数量的 scope
5. `--no-library-resolve` 下 warmup 不启动
6. `daemon-process.ts` 定时清理生效（用 `--cache-ttl-days 1` + mock 时间验证）
7. `libraryLocatorIntegration.test.ts` 通过

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| warmup 拖慢启动 | 用 `queueMicrotask`/独立 promise，非阻塞 `ready` |
| mvn 多次 JVM 启动开销 | 每批 20 artifact 合并调用；老 Maven 回退按批 `includeGroupIds=g1,g2` |
| `/config` 热更新后遗留状态 | 关键值（`cacheTtlDays`）刷新定时器 |
| 定时清理与 in-flight resolve 冲突 | `cacheCleaner` 清理时跳过持有锁的 scope |
| 单例跨 workspace 共用 | `LibraryClassLocator` 本就无 workspace 状态；`workspaceLink` 接受 workspaceRoot 参数 |

## 7. 回滚策略

- **[daemonStateManager.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/core/daemonStateManager.ts)**：移除 `getLibraryLocator` 与 `warnings`
- **[projectService.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/services/projectService.ts)**：删除 warmup 挂载
- **[routeHandlers.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon/routes/routeHandlers.ts)**：删除 4 个新增端点，`/status` 回滚不含 `warnings`
- **[daemon-process.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/daemon-process.ts)**：移除清理定时器
- 回滚后 daemon 模式下 jar 内类每次请求都重走完整流水线，但功能仍在（由 SP01-SP04 提供）
