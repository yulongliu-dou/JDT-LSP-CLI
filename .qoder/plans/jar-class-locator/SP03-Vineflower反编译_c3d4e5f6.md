# SP03 — Vineflower 反编译主引擎（M3a）

> 上级：[索引-Jar源码定位主线](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/索引-Jar源码定位主线_f1a2b3c4.md)
> 前置：[SP02-缓存与URI重写](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-缓存与URI重写_b2c3d4e5.md)
> 并行：[SP04-源码获取与CLI配置](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
> 原主计划：[Jar类源码定位增强_7a3afe89.md](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/Jar%E7%B1%BB%E6%BA%90%E7%A0%81%E5%AE%9A%E4%BD%8D%E5%A2%9E%E5%BC%BA_7a3afe89.md)
> 对应原 Task：Task 3 反编译链路 + Task 5.1 `decompiled/` 缓存布局

## 1. 目标

在 `LibraryClassLocator` 的三级管道中接入 Vineflower 反编译器，当 sources jar 不可用时产出可读的 `.java`，并为反编译产物生成尽力而为的行号映射与 `note` 元数据，让 Agent 知道不要直接编辑。

## 2. 依赖

- 前置 [SP02](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-缓存与URI重写_b2c3d4e5.md) 已就绪（`globalCache` / `workspaceLink` / `accessTracker` 可用）
- 依赖 SP01 引入的 [platform/childProcessUtils.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/childProcessUtils.ts) 做 java 子进程调用
- 依赖 [launcher.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 的 Java 可执行文件探测

## 3. 受影响文件清单

### 3.1 新建

| 路径 | 职责 |
|---|---|
| [src/libraryProvider/decompile/decompileProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/decompile/decompileProvider.ts) | Vineflower 调用入口：`decompile(jarPath, fqcn)` |
| [src/libraryProvider/decompile/vineflowerRunner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/decompile/vineflowerRunner.ts) | `java -jar vineflower.jar <in> <out>` 封装 |
| [src/libraryProvider/decompile/lineMap.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/decompile/lineMap.ts) | 反编译产物 ↔ 字节码行号映射（尽力而为） |
| [vendor/vineflower-<ver>.jar](file:///e:/LSP_Scripy/jdt-lsp-cli/vendor/) | 内置反编译器二进制 |
| [test/unit/libraryProvider/lineMap.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/lineMap.test.ts) | 方法签名对齐单元测试 |
| [test/unit/libraryProvider/vineflowerRunner.test.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/test/unit/libraryProvider/vineflowerRunner.test.ts) | mock Java 子进程 |

### 3.2 修改

| 路径 | 改动摘要 |
|---|---|
| [src/libraryProvider/core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts) | 在 sources 命中失败后插入 decompile 分支；失败再回退到 classFileContents |
| [package.json](file:///e:/LSP_Scripy/jdt-lsp-cli/package.json) | `files` 字段追加 `vendor/` |

## 4. 实施步骤

### Task 3.1：引入 Vineflower 二进制

- 选择稳定版（推荐 Vineflower 1.10+）
- 放置路径 `vendor/vineflower-<ver>.jar`，建议在 `src/libraryProvider/decompile/vineflowerRunner.ts` 顶部用常量 `VINEFLOWER_JAR_NAME` 集中管理版本号
- 修改 [package.json](file:///e:/LSP_Scripy/jdt-lsp-cli/package.json)：

```json
{
  "files": [
    "dist",
    "vendor"
  ]
}
```

- 确认 `.gitignore` 不会误忽略 `vendor/*.jar`

### Task 3.2：vineflowerRunner

[decompile/vineflowerRunner.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/decompile/vineflowerRunner.ts)：

```ts
export interface VineflowerOptions { timeoutMs?: number; extraArgs?: string[]; }
export async function runVineflower(jarPath: string, outDir: string, opts?: VineflowerOptions): Promise<void>
```

关键实现：

- `javaExecutable` 复用 [launcher.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/jdt/launcher.ts) 已有探测；失败抛错让上层降级
- `vineflowerJar` 路径策略：
  1. 开发态：`path.join(__dirname, '../../../vendor/<jar>')`
  2. 发布态（npm 包）：`require.resolve('../../vendor/<jar>')` 或按 `__dirname` 向上探测
- 参数：`['-jar', vineflowerJar, '--silent=1', jarPath, outDir]`（单文件反编译按需调整）
- 用 [platform/childProcessUtils.ts#spawnWithTimeout](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/platform/childProcessUtils.ts) 控制 60s 超时
- 超时/失败：抛 `VineflowerError` 带 stderr 片段
- 日志：stdout/stderr 尾部 4KB 写入 `~/.lsp-cache/global/decompiled/<scope>/.vineflower.log`

### Task 3.3：decompileProvider

[decompile/decompileProvider.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/decompile/decompileProvider.ts)：

```ts
export async function decompile(ctx: {
  jarPath: string;
  scope: string;
  fqcn: string;
}): Promise<{ filePath: string; lineMap: LineMap } | null>
```

流程：

1. 目标目录 `~/.lsp-cache/global/decompiled/<scope>/`
2. 全 jar 反编译一次（成本可接受；单类反编译 Vineflower 不友好）；命中后续请求直接复用
3. 写入标记文件 `.decompiled-ok` 表示已完成
4. 对目标 fqcn 生成 lineMap，缓存到 `<fqcn>.linemap.json`
5. 失败写 `.failed` 标记后返回 null，上层走 classFileContents

### Task 3.4：lineMap

[decompile/lineMap.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/decompile/lineMap.ts)：

```ts
export interface LineMap {
  translate(byteCodeRange: Range): { range: Range; quality: 'best-effort' | 'exact' | 'n/a' };
}
export async function buildLineMap(javaFilePath: string, methodSignatures: string[]): Promise<LineMap>
```

策略：

- 解析反编译产物，按方法名 + 形参类型定位方法声明行
- 字节码 `range` 若在方法范围内，映射到方法声明行，`quality: 'best-effort'`
- 无法匹配时返回 `{ range: { start: 0, end: 0 }, quality: 'n/a' }`
- 不要求准确行号（JDT LS 为反编译产物自身提供的行号由下次请求时 LS 给出，这里主要用于首次跳转）
- `methodSignatures` 来源：后续可通过 LSP `documentSymbol` 补充；本期先用正则从反编译文本抽取 `public\s+\w+\s+<name>\(` 的行号索引

### Task 3.5：LibraryClassLocator 接入

更新 [core/libraryClassLocator.ts](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/core/libraryClassLocator.ts) 流水线（补齐 decompile 分支）：

```ts
// ... JDK 快速通道 ...
// ... sources jar 分支（SP04 提供） ...
if (!cachedFile) {
  try {
    const { filePath, lineMap } = await decompileProvider.decompile({ jarPath, scope, fqcn });
    const mapped = lineMap.translate(range);
    return {
      uri: pathToFileURL(workspaceLinkPath).href,
      range: mapped.range,
      source: 'decompiled',
      originalUri: uri,
      originalRange: range,
      note: 'Decompiled code. Line mapping is approximate. Use method signatures for orientation. Avoid modifying this file.',
      lineMapping: mapped.quality,
      lockWaitMs: waitMs,
    };
  } catch (e) {
    logger.warn('decompile failed, fallback to classFileContents', e);
  }
}
// ... classFileContents 兜底 ...
```

### Task 3.6：配置开关

读取 [config.ts#decompiler](file:///e:/LSP_Scripy/jdt-lsp-cli/src/libraryProvider/config.ts)：

- `'vineflower'`（默认）→ 调 decompileProvider
- `'jdt'` → 跳过反编译，直接走 classFileContents
- `'off'` → 跳过反编译，直接走 classFileContents 并记录 `note: 'Decompiler disabled by config.'`

### Task 3.7：单元测试

- `lineMap.test.ts`：用固定反编译文本样本，断言方法签名匹配后的映射行号；`n/a` 路径返回 0-0
- `vineflowerRunner.test.ts`：mock `spawn`，断言参数列表、超时、stderr 处理

## 5. 验收标准

1. 对一个无 sources jar 的依赖（如 `ognl.Ognl`），definition 返回 `source: 'decompiled'`、`note` 存在、`lineMapping: 'best-effort'`
2. 反编译产物落在 `~/.lsp-cache/global/decompiled/<g>/<a>/<v>/`，项目内 `.lsp-cache/jars/<g>/<a>/<v>/` 可见
3. `--decompiler off` 下反编译分支被跳过，返回 `source: 'class-file-contents'`
4. Vineflower 超时（mock）时不影响主链路，返回 classFileContents 兜底
5. `package.json` 发布产物包含 `vendor/` 目录
6. 新增单元测试全部通过

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| Vineflower jar 体积（~5MB） | 列入 `package.json#files`，接受为 CLI 发布成本 |
| 全 jar 反编译耗时 | 首次命中后缓存；命中二次走缓存即可 |
| Java 版本不兼容 Vineflower | 检测 Java 版本（Vineflower 需要 Java 11+）；低版本记录 `.failed` |
| 方法签名对齐失败 | `lineMapping: 'best-effort'` / `'n/a'`，Agent 可据此判断 |
| vineflower stdout 污染日志 | 使用 `--silent=1` |

## 7. 回滚策略

- **新建文件**：删除 `src/libraryProvider/decompile/` 与 `test/unit/libraryProvider/{lineMap,vineflowerRunner}.test.ts`
- **vendor/**：整个目录移除
- **package.json**：还原 `files` 字段
- **libraryClassLocator.ts**：移除 decompile 分支，让流水线在 sources jar 失败后直接走 classFileContents
- 回滚后退化为 SP02 + SP04（如果 SP04 已完成）组合，所有其他行为保持
