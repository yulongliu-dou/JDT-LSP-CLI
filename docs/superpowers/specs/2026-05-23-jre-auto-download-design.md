# JRE 自动下载功能设计文档

**日期**: 2026-05-23
**状态**: 待实施

## 概述

实现 `jdt-lsp-cli` 项目分发安装时自动下载 Adoptium JRE 21，不再依赖 VS Code 红帽 Java 扩展自带的 JRE 环境。

## 背景

当前 JRE 依赖：
1. VS Code Red Hat Java 扩展 bundled JRE（自动发现，优先级最高）
2. `JAVA_HOME` 环境变量（守护进程强制要求）
3. 系统 PATH 上的 `java`（兜底）

已有 `src/jdt/embedded/jreManager.ts` 存根文件，`~/.jdt-lsp-cli/jre/` 作为存储目录，但 `downloadJre()` 未实现。

## 设计目标

- 用户安装 `npm install -g jdt-lsp-cli` 后首次运行 `jls` 时自动完成 JRE 下载，无感化体验
- 网络通畅时静默自动下载，无需用户确认
- 下载过程全周期可视化（进度条、速度、剩余时间、SHA256 校验）
- 网络不通或下载失败时优雅降级到系统已有 JRE（>= 21）
- 不引入任何 npm 第三方依赖

---

## 1. JRE 选型

| 维度 | 选择 |
|------|------|
| **供应商** | Adoptium (Eclipse Temurin) |
| **版本** | Java 21 LTS |
| **镜像类型** | `jre`（精简包，~47MB，不含编译工具和调试符号） |
| **架构** | 运行时检测：windows/mac/linux + x64/aarch64 |

## 2. JRE 优先级

从高到低：

1. **内嵌 JRE** — `~/.jdt-lsp-cli/jre/{version}/`（Adoptium 下载的 JRE）
2. **Red Hat 扩展 JRE** — `~/.vscode/extensions/redhat.java-*/jre/`
3. **JAVA_HOME** — 环境变量指向的 JDK/JRE
4. **系统 PATH** — PATH 中的 `java` 命令

## 3. 下载时机

**首次运行时延迟下载（lazy init）**。用户执行 `jls <command>` 时检测本地是否有内嵌 JRE，无则触发下载流程。

## 4. 下载与可视化流程

### 4.1 网络探测 + 静默下载

```
╔══════════════════════════════════════════════╗
║  🔍 正在检测 Java 运行环境...                  ║
║                                              ║
║  未找到内嵌 JRE，正在下载 Adoptium JRE 21      ║
║  平台: Windows x64  ·  大小: ~47 MB            ║
╚══════════════════════════════════════════════╝
```

- 先向 `api.adoptium.net` 发送 HEAD 请求探测网络（3 秒超时）
- 网络可达 → 直接开始下载，无需用户确认
- 网络不可达 → 跳过下载，进入降级流程（见第 5 节）

### 4.2 下载阶段

```
╔══════════════════════════════════════════════╗
║  ⬇ 正在下载 Adoptium JRE 21...                ║
║                                              ║
║  ████████████░░░░░░░░░░░░░░  62%             ║
║  29.1 MB / 47.2 MB  ·  3.2 MB/s  ·  剩余 6s  ║
║                                              ║
║  来源: api.adoptium.net                        ║
╚══════════════════════════════════════════════╝
```

### 4.3 完成阶段

```
╔══════════════════════════════════════════════╗
║  ✓ 下载完成                                   ║
║  ✓ SHA256 校验通过                            ║
║  ✓ 解压完成: ~/.jdt-lsp-cli/jre/21.0.x+xx/   ║
║                                              ║
║  JRE 就绪，正在启动 JDT LS...                  ║
╚══════════════════════════════════════════════╝
```

## 5. 降级与错误处理

### 5.1 网络不可达（下载前置检查）

```
检测到 api.adoptium.net 不可达
  ↓
提示: "无法连接到 Adoptium 下载服务，将尝试使用系统已有 JRE"
  ↓
检查降级路径 (JRE >= 21):
  ├── Red Hat 扩展 JRE
  ├── JAVA_HOME
  └── PATH java

找到 JRE >= 21:
  ↓
  警告: "将使用非优化版系统 JRE {version}"
  提示: "Adoptium 内嵌 JRE 经过特殊优化：精简体积、更低内存占用"
  提示: "网络恢复后运行 `jls jre download` 可获取优化版 JRE"
  → 使用该系统 JRE (source='redhat'|'system')

未找到 JRE >= 21:
  ↓
  提示: "系统中未安装 JRE >= 21"
  提示: "Java 21 提供虚拟线程、分代 ZGC 等特性，性能更佳、内存占用更低"
  输出手动下载说明 → 退出(1)
```

### 5.2 下载失败

```
下载过程中失败 (网络错误/校验失败/磁盘不足)
  ↓
检查降级路径 (同 5.1)

找到 JRE >= 21:
  ↓
  提示: "下载失败，将使用系统中的 JRE {version}"
  提示: "建议稍后运行 `jls jre download` 重新获取优化版 JRE"
  → 使用该系统 JRE (source='redhat'|'system')

未找到 JRE >= 21:
  ↓
  提示: "未找到兼容 JRE (需要 >= 21)"
  提示: "Java 21 性能更佳、内存占用更低"
  输出手动下载说明 → 退出(1)
```

### 5.3 手动下载说明

```
╔══════════════════════════════════════════════╗
║  ✗ 下载失败: {失败原因}                        ║
║                                              ║
║  请手动下载 JRE 并放置到以下目录:               ║
║                                              ║
║  下载地址:                                    ║
║  https://adoptium.net/download/...            ║
║                                              ║
║  放置目录:                                    ║
║  ~/.jdt-lsp-cli/jre/21.0.x+xx/               ║
║  (需包含 bin/java 或 bin/java.exe)            ║
║                                              ║
║  详细说明: https://github.com/.../wiki/JRE     ║
╚══════════════════════════════════════════════╝
```

## 6. 版本检测

解析 `java -version` 输出（stderr）：

```
openjdk version "21.0.5" 2024-10-15    → 主版本 21
openjdk version "17.0.9" 2023-10-17    → 主版本 17
```

提取引号中的版本号，解析首位数字作为主版本号，判断 `>= 21`。

## 7. Adoptium API

### 请求

```
GET https://api.adoptium.net/v3/assets/latest/21/hotspot
  ?image_type=jre
  &project=jdk
  &vendor=eclipse
  &os={os}
  &arch={arch}
```

### 平台参数映射

| Node.js | Adoptium API |
|---------|-------------|
| `os.platform() === 'win32'` | `os=windows` |
| `os.platform() === 'darwin'` | `os=mac` |
| `os.platform() === 'linux'` | `os=linux` |
| `os.arch() === 'x64'` | `arch=x64` |
| `os.arch() === 'arm64'` | `arch=aarch64` |

### 响应关键字段

```json
[{
  "binary": {
    "package": {
      "link": "https://github.com/adoptium/.../jdk-21.0.5+11-jre_windows-x64.zip",
      "name": "jdk-21.0.5+11-jre_windows-x64.zip",
      "size": 49283072,
      "checksum": "abc123..."
    }
  },
  "version": {
    "semver": "21.0.5+11"
  }
}]
```

## 8. 存储结构

```
~/.jdt-lsp-cli/
└── jre/
    └── 21.0.5+11/
        ├── bin/
        │   ├── java         (Unix)
        │   └── java.exe     (Windows)
        ├── lib/
        └── ...
```

## 9. JreManager API

```typescript
interface JreInfo {
  version: string;          // "21.0.5+11"
  path: string;             // 完整路径
  javaExe: string;          // bin/java 或 bin/java.exe
  source: 'embedded' | 'redhat' | 'system';
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
  speed: number;             // bytes/s
}

class EmbeddedJreManager {
  // 公共 API
  async ensure(): Promise<JreInfo>;
  async getStatus(): Promise<JreStatus>;
  async remove(): Promise<void>;

  // 内部方法
  private async probeNetwork(): Promise<boolean>;
  private async downloadJre(): Promise<JreInfo>;
  private async verifyChecksum(file: string, expected: string): Promise<boolean>;
  private async extractJre(tarball: string, dest: string): Promise<void>;
  private async detectJavaVersion(javaExe: string): Promise<string | null>;
  private async fallbackToExistingJre(minVersion: number): Promise<JreInfo>;
  private checkDiskSpace(requiredBytes: number): boolean;
}
```

### ensure() 流程

```
1. 检查 ~/.jdt-lsp-cli/jre/ 下是否有有效 JRE
   → 有: 返回 JreInfo (source='embedded')
   → 无: 进入步骤 2

2. 网络探测 (HEAD api.adoptium.net, 3s 超时)
   → 可达: 直接进入步骤 3（无需用户确认，无感化）
   → 不可达: fallbackToExistingJre(minVersion=21) → 步骤 4

3. 执行下载
   → 请求 Adoptium API 获取 URL + checksum
   → 流式下载 + 实时进度条渲染
   → SHA256 校验
   → 系统 tar/unzip 解压
   → 成功: 返回 JreInfo (source='embedded')
   → 失败: fallbackToExistingJre(minVersion=21) → 步骤 4

4. fallbackToExistingJre(minVersion):
   → 扫描 Red Hat JRE → java -version → 检查 >= 21
   → 扫描 JAVA_HOME   → java -version → 检查 >= 21
   → 扫描 PATH java   → java -version → 检查 >= 21
   → 找到: 输出降级提示、返回 JreInfo (source='redhat'|'system')
   → 未找到: 打印帮助信息，process.exit(1)
```

## 10. 集成修改点

### launcher.ts

- 构造函数或 `findJdtLsPath()` 中调用 `EmbeddedJreManager.ensure()`
- JRE 发现和 JDT LS 路径发现解耦为独立逻辑

### daemonValidation.ts

- `JAVA_HOME` 从强制要求改为可选（内嵌 JRE 存在时不需要）
- 新增检查：内嵌 JRE 或 JAVA_HOME 或 PATH java >= 21 任一满足即可

### daemon.ts

- 启动 `JDT LS` 子进程前，确保 `JAVA_HOME` 环境变量指向可用 JRE（内嵌 JRE 路径或系统路径）

## 11. CLI 管理命令

```bash
jls jre status      # 查看当前 JRE 状态
jls jre download    # 手动触发下载（覆盖已有）
jls jre remove      # 删除内嵌 JRE
```

`jls jre status` 输出：

```
JRE 状态:
  来源:   embedded (Adoptium)
  版本:   21.0.5+11 (LTS)
  路径:   ~/.jdt-lsp-cli/jre/21.0.5+11/
  大小:   48.3 MB
  状态:   ✓ 就绪
```

## 12. 解压策略

- **Windows**: 使用系统内置 `Expand-Archive`（PowerShell）或 Node.js `zlib + stream` 处理 `.zip`
- **macOS / Linux**: 使用系统内置 `tar -xzf` 命令（全平台自带）
- 零 npm 依赖

## 13. 测试策略

| 类型 | 内容 | 环境 |
|------|------|------|
| 单元测试 | 平台参数映射、版本号解析 (`21.0.5`→21)、API URL 构建、磁盘空间检查逻辑 | CI |
| 集成测试 | Mock HTTP Server 模拟下载+校验成功/失败、版本检测与降级选择 | CI |
| E2E | 真实下载完整流程（47MB） | 仅手动，CI 中用 JAVA_HOME 跳过 |

## 14. 非目标

- 不下载 JDT Language Server 本身（仍从 Red Hat 扩展或其他路径发现）
- 不支持断点续传（v1 不做）
- 不支持代理配置（v1 不做，可后续添加 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量支持）
- 不引入任何第三方 npm 依赖
