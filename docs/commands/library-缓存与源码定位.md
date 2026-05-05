# library 命令 - 缓存与源码定位

管理 jar 类源码缓存，包括统计、清理和预热操作。

## 基本信息

- **命令**: `cache`
- **功能**: 管理 jar 类源码缓存（JDK src.zip / Maven sources-jar / Vineflower 反编译产物）

## 背景

JDT LS 返回的 `jdt://` URI 指向 jar 包内的 `.class` 文件，无法直接打开和编辑。jdt-lsp-cli 实现了**三级源码解析管道**，按优先级自动获取可读源码：

```
jdt:// URI
  │
  ├─ [1] JDK 快速通道  ──→ jdk-src        (lineMapping: exact)
  │    从 src.zip 抽取 JDK 标准库源码
  │
  ├─ [2] Maven sources  ──→ sources-jar    (lineMapping: exact)
  │    从 Maven 仓库下载 -sources.jar 并提取
  │
  ├─ [3] Vineflower 反编译 ──→ decompiled  (lineMapping: best-effort / n/a)
  │    对无 sources 的 jar 全量反编译
  │
  └─ [4] classFileContents 兜底 ──→ class-file-contents  (lineMapping: n/a)
       JDT LS 原生字节码预览
```

## 缓存目录布局

```
~/.lsp-cache/
├── global/
│   ├── jdk/<version>/<module>/        # JDK 源码抽取产物
│   ├── sources/<g>/<a>/<v>/           # Maven sources jar 提取
│   ├── decompiled/<scope>/            # Vineflower 反编译 .java
│   └── class-file-contents/<scope>/   # JDT LS 字节码预览
│
└── daemon-config.json                 # 运行时配置（TTL、反编译器选择等）

<workspace>/.lsp-cache/jars/           # ← symlink/junction → global/
  ├── jdk/<version>/<module>/
  ├── sources/<g>/<a>/<v>/
  ├── decompiled/<scope>/
  └── class-file-contents/<scope>/
```

- **global 目录**（`~/.lsp-cache/global/`）：跨项目共享的主本
- **workspace 目录**（`.lsp-cache/jars/`）：通过 symlink（macOS/Linux）或 junction（Windows 管理员）指向 global；无 symlink 权限时自动降级为**文件拷贝**

## 语法

```bash
jls cache <subcommand> [options]
```

## 子命令

| 子命令 | 说明 |
|--------|------|
| `stats` | 显示缓存统计信息 |
| `clean` | 清理缓存（过期 / 全部） |
| `warm` | 预热：预取项目直接依赖的 sources jar |

## 子命令详解

### cache stats

显示全局缓存的统计信息。

```bash
jls cache stats
```

**输出示例：**
```json
{
  "success": true,
  "data": {
    "buckets": {
      "jdk": { "scopes": 1, "files": 42, "sizeBytes": 204800 },
      "sources": { "scopes": 15, "files": 320, "sizeBytes": 5242880 },
      "decompiled": { "scopes": 8, "files": 96, "sizeBytes": 1572864 },
      "class-file-contents": { "scopes": 3, "files": 12, "sizeBytes": 49152 }
    },
    "totalFiles": 470,
    "totalSizeBytes": 7149696,
    "config": {
      "sourceDownloadMode": "mvn",
      "decompiler": "vineflower",
      "cacheTtlDays": 7
    }
  }
}
```

### cache clean

清理缓存文件。

```bash
# 清理过期缓存（超过 TTL 天未访问）
jls cache clean --stale

# 清理所有缓存
jls cache clean --all

# 指定 TTL 天数（覆盖配置值）
jls cache clean --stale --ttl-days 3
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--stale` | 仅清理过期缓存（超过 cacheTtlDays 未命中） |
| `--all` | 清理所有缓存 |
| `--ttl-days <n>` | 指定 TTL 天数（覆盖 daemon-config.json 中的 cacheTtlDays） |

### cache warm

预热：预先解析项目直接依赖的 Maven sources jar。

```bash
# 对指定项目预热
jls cache warm --project E:\mybatis-3-master

# 在 daemon 已启动的项目上预热
jls cache warm
```

- 仅在 daemon 模式下有效
- 预取内容：项目 `pom.xml` 中直接依赖的 jar（不包含传递依赖）
- 建议在 daemon 启动后、CI 批量查询前执行，避免首个查询等待下载

## 配置热更新

通过 daemon 的 `/config` HTTP 端点可以热更新运行时配置，无需重启：

| 配置键 | 取值 | 说明 |
|--------|------|------|
| `sourceDownloadMode` | `"mvn"` / `"http"` / `"none"` | 源码下载策略 |
| `decompiler` | `"vineflower"` / `"cfr"` / `"none"` | 反编译引擎 |
| `cacheTtlDays` | 正整数（默认 7） | 缓存 TTL 天数 |
| `libraryResolveEnabled` | `true` / `false` | jar 类解析总开关 |
| `warmupEnabled` | `true` / `false` | 启动时是否预取 |

## FAQ

### Windows 下 symlink 降级如何识别？

使用 `jls cache stats` 或查看 daemon `/status` 的 `warnings` 字段。当 symlink 不可用时，会出现类似以下警告：

```
Symbolic links unavailable for scope sources/ognl/ognl/3.3.4; falling back to file copies.
```

此时 `.lsp-cache/jars/` 下的文件为独立拷贝，与 `~/.lsp-cache/global/` 保持同步（解析时总是先读 global 主本，再 link/copy 到 workspace）。

### `--source-download-mode off` 什么场景使用？

- **离线环境 / 内网隔离**：无法访问 Maven Central
- **CI 快速验证**：不关心源码内容，只需快速拿到 classFileContents
- **依赖完整性测试**：验证在无 sources 时反编译兜底的正确性

### 缓存占用过多磁盘空间？

```bash
# 查看占用
jls cache stats

# 清理 30 天前的过期缓存
jls cache clean --stale --ttl-days 30

# 彻底清空
jls cache clean --all
```

### 如何验证三级管道是否正常工作？

1. 确认 daemon 运行且 `libraryResolveEnabled: true`（查看 `/status`）
2. `jls find java.util.function.Function --kind Class` → 应有 `jdk-src` 结果
3. `jls find ognl.Ognl --kind Class` → 应有 `sources-jar` 或 `decompiled` 结果

## 相关命令

- [daemon](daemon-守护进程管理.md) - 守护进程管理
- [config](config-配置管理.md) - 配置文件管理
- [全局选项](../全局选项.md) - `--source-download-mode`、`--decompiler`、`--cache-ttl-days`、`--no-library-resolve`
