# config 命令 - 配置管理

管理 JDT LSP CLI 的配置文件，包括 JVM 参数、守护进程设置等。

## 基本信息

- **命令**: `config`
- **功能**: 创建、查看、管理配置文件

## 语法

```bash
jls config <subcommand> [options]
```

## 子命令

| 子命令 | 说明 |
|--------|------|
| `init` | 创建默认配置文件 |
| `show` | 显示当前配置 |
| `path` | 显示配置文件路径 |
| `defaults` | 显示默认 JVM 配置 |

## 子命令详解

### config init

创建默认配置文件。

#### 选项

| 选项 | 简写 | 说明 |
|------|------|------|
| `--force` | `-f` | 覆盖已存在的配置文件 |

#### 使用示例

```bash
# 创建配置文件（如已存在会提示）
jls config init

# 强制覆盖已有配置
jls config init --force
```

**输出示例：**
```
Config file created: C:\Users\username\.jdt-lsp-cli\config.json
You can now edit the config file to customize JVM parameters.
```

### config show

显示当前配置信息。

```bash
jls config show
```

**输出示例：**
```
Config file: C:\Users\username\.jdt-lsp-cli\config.json
File exists: true

Current configuration:
{
  "jvm": {
    "xms": "256m",
    "xmx": "2g",
    "useG1GC": true,
    "maxGCPauseMillis": 200,
    "useStringDeduplication": true,
    "softRefLRUPolicyMSPerMB": 50,
    "extraArgs": []
  },
  "daemon": {
    "port": 9876,
    "idleTimeoutMinutes": 30,
    "maxProjects": 1,
    "perProjectMemory": "1g"
  }
}
```

### config path

显示配置文件的路径。

```bash
jls config path
```

**输出示例：**
```
C:\Users\username\.jdt-lsp-cli\config.json
```

### config defaults

显示默认的 JVM 配置（不包含用户自定义配置）。

```bash
jls config defaults
```

**输出示例：**
```
Default JVM configuration:
{
  "xms": "256m",
  "xmx": "2g",
  "useG1GC": true,
  "maxGCPauseMillis": 200,
  "useStringDeduplication": true,
  "softRefLRUPolicyMSPerMB": 50,
  "extraArgs": []
}
```

## 配置文件

### 配置文件位置

| 系统 | 路径 |
|------|------|
| Windows | `C:\Users\<username>\.jdt-lsp-cli\config.json` |
| Linux/Mac | `~/.jdt-lsp-cli/config.json` |

### 配置结构

```json
{
  "jvm": {
    "xms": "256m",
    "xmx": "2g",
    "useG1GC": true,
    "maxGCPauseMillis": 200,
    "useStringDeduplication": true,
    "softRefLRUPolicyMSPerMB": 50,
    "extraArgs": []
  },
  "daemon": {
    "port": 9876,
    "idleTimeoutMinutes": 30,
    "maxProjects": 1,
    "perProjectMemory": "1g"
  }
}
```

### JVM 配置选项

| 选项 | 说明 | 默认值 | 建议值 |
|------|------|--------|--------|
| `xms` | 初始堆内存 | `256m` | 大型项目: `512m` |
| `xmx` | 最大堆内存 | `2g` | 大型项目: `4g` |
| `useG1GC` | 使用 G1 垃圾回收器 | `true` | 保持 `true` |
| `maxGCPauseMillis` | GC 最大暂停时间（毫秒） | `200` | 根据需求调整 |
| `useStringDeduplication` | 字符串去重 | `true` | 保持 `true` |
| `softRefLRUPolicyMSPerMB` | 软引用 LRU 策略 | `50` | 保持默认 |
| `extraArgs` | 额外 JVM 参数 | `[]` | 按需添加 |

### Daemon 配置选项

| 选项 | 说明 | 默认值 | 建议值 |
|------|------|--------|--------|
| `port` | 守护进程端口 | `9876` | 避免冲突即可 |
| `idleTimeoutMinutes` | 空闲超时（分钟） | `30` | 根据使用频率调整 |
| `maxProjects` | 最大项目数 | `1` | 多项目: `3-5` |
| `perProjectMemory` | 每个项目内存限制 | `1g` | 大型项目: `2g` |

## 使用示例

### 示例 1: 创建并编辑配置

```bash
# 1. 创建配置文件
jls config init

# 2. 查看配置文件路径
jls config path

# 3. 用编辑器打开并修改
notepad C:\Users\username\.jdt-lsp-cli\config.json

# 4. 查看修改后的配置
jls config show
```

### 示例 2: 为大型项目优化 JVM

编辑 `config.json`：

```json
{
  "jvm": {
    "xms": "512m",
    "xmx": "4g",
    "useG1GC": true,
    "maxGCPauseMillis": 200,
    "useStringDeduplication": true,
    "softRefLRUPolicyMSPerMB": 50,
    "extraArgs": [
      "-XX:+UseCompressedOops",
      "-XX:+AlwaysPreTouch"
    ]
  },
  "daemon": {
    "port": 9876,
    "idleTimeoutMinutes": 60,
    "maxProjects": 3,
    "perProjectMemory": "2g"
  }
}
```

### 示例 3: 添加自定义 JVM 参数

```json
{
  "jvm": {
    "xms": "256m",
    "xmx": "2g",
    "useG1GC": true,
    "maxGCPauseMillis": 200,
    "useStringDeduplication": true,
    "softRefLRUPolicyMSPerMB": 50,
    "extraArgs": [
      "-Djava.net.preferIPv4Stack=true",
      "-XX:+HeapDumpOnOutOfMemoryError",
      "-XX:HeapDumpPath=/tmp/heapdump.hprof"
    ]
  }
}
```

## 注意事项

1. **配置文件格式**: 必须是有效的 JSON 格式
2. **重启生效**: 修改配置后需要重启守护进程
3. **内存设置**: `xmx` 不应超过系统可用内存
4. **端口冲突**: 如端口被占用，修改 `daemon.port` 或使用 `--port` 参数
5. **多项目**: 增加 `maxProjects` 可以同时加载多个项目，但会占用更多内存

## 常见用例

### 优化大型项目性能

```bash
# 1. 创建配置
jls config init

# 2. 编辑配置，增加内存
# 编辑 config.json: xmx: "4g", perProjectMemory: "2g"

# 3. 重启守护进程
jls daemon stop
jls daemon start --eager --init-project E:\large-project --wait
```

### 调试 JVM 问题

```json
{
  "jvm": {
    "xms": "256m",
    "xmx": "2g",
    "useG1GC": true,
    "maxGCPauseMillis": 200,
    "useStringDeduplication": true,
    "softRefLRUPolicyMSPerMB": 50,
    "extraArgs": [
      "-verbose:gc",
      "-XX:+PrintGCDetails",
      "-Xloggc:/tmp/gc.log"
    ]
  }
}
```

### 减少资源占用

```json
{
  "jvm": {
    "xms": "128m",
    "xmx": "1g",
    "useG1GC": true,
    "maxGCPauseMillis": 500,
    "useStringDeduplication": false,
    "softRefLRUPolicyMSPerMB": 100,
    "extraArgs": []
  },
  "daemon": {
    "port": 9876,
    "idleTimeoutMinutes": 15,
    "maxProjects": 1,
    "perProjectMemory": "512m"
  }
}
```

## 相关命令

- [daemon](daemon.md) - 管理守护进程
- [全局选项](../global-options.md) - 命令行全局选项
