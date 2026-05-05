# Jar 类源码定位增强 - 主索引

> 本索引文件为子计划入口。完整背景、详细方案、关键风险请参见原主计划 [Jar类源码定位增强_7a3afe89.md](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/Jar%E7%B1%BB%E6%BA%90%E7%A0%81%E5%AE%9A%E4%BD%8D%E5%A2%9E%E5%BC%BA_7a3afe89.md)（保留为历史完整版，本次拆分不修改）。

## 设计目标

当前项目遇到 jar 中的类被三处显式代码 `!target.uri.includes('jdt://')` 丢弃，且路径提取处写死 `uri.replace('file://', '')`，LSP 初始化未声明 jdt:// contentProvider 能力。

本方案把"丢弃 jdt://"改为"把 jdt:// 解析成真实 file:// 缓存路径"，所有下游命令无须改写业务逻辑即可自然支持 jar 内类。

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

## 运行时目录

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

## 里程碑与子计划

| 里程碑 | 子计划 | 价值 | 可并行 |
|---|---|---|---|
| M1 | [SP01-骨架与JDT兜底](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-骨架与JDT兜底_a1b2c3d4.md) | 端到端跑通，最低档兜底 | — |
| M2 | [SP02-缓存与URI重写](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP02-缓存与URI重写_b2c3d4e5.md) | 首次"定位到真实 file://" | — |
| M3a | [SP03-Vineflower反编译](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP03-Vineflower反编译_c3d4e5f6.md) | 反编译产物质量达标 | 与 SP04 |
| M3b | [SP04-源码获取与CLI配置](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md) | sources jar 优先命中 + CLI 配置 | 与 SP03 |
| M4 | [SP05-Daemon集成与预取](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP05-Daemon集成与预取_e5f6a7b8.md) | 长期稳定、首跳体感快 | — |
| M5 | [SP06-测试与文档](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP06-测试与文档_f6a7b8c9.md) | 可发版 | — |

## 依赖拓扑

```
SP01 ──► SP02 ──┬──► SP03 ──┐
                │           ├──► SP05 ──► SP06
                └──► SP04 ──┘
```

## 跨平台要点分布（原 Task 11）

不单独成子计划，按以下方式嵌入：

- **SP01**：`platform/pathUtils.ts`（11.1 路径规范）、`platform/childProcessUtils.ts`（11.3 子进程）、`platform/capsDetector.ts`（能力探测）
- **SP02**：`workspaceLink.ts`（11.2 symlink/junction 跨平台）、`accessTracker.ts`（11.7 访问日志）、.gitignore 处理（11.8）、路径大小写（11.9）
- **SP04**：`mvnRunner.ts`（11.3 mvn.cmd）、`jdkSourceProvider.ts` 的 JAVA_HOME 探测（11.4）、~/.m2 自定义仓库（11.5）、`globalCache.lock`（11.6）
- **SP06**：CI skip 矩阵 + Windows 11 与 macOS 双平台手动验证（11.10）

## 非目标（本期不做）

- Gradle 项目支持（接口已预留 `DependencyResolver`）
- 自研 Maven HTTP 下载器（接口已预留 `httpDownloader.ts`）
- jar 内类的 rename/refactor（JDT LS 不支持）
- 缓存空间上限限额（仅按 7 天 TTL）
- 跨 daemon 进程的分布式锁

## 子计划通用约定

- 每份子计划内部统一为 7 章节：目标 / 依赖 / 受影响文件清单 / 实施步骤 / 验收标准 / 风险与对策 / 回滚策略
- 文件路径引用统一 `file:///e:/LSP_Scripy/jdt-lsp-cli/...` 链接格式
- 执行顺序：SP01 → SP02 → (SP03 ∥ SP04) → SP05 → SP06
- 每完成一个子计划提交一次
