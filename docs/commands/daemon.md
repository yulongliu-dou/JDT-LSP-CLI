# daemon 命令 - 守护进程管理

管理 JDT Language Server 的守护进程，提供快速响应能力。

## 基本信息

- **命令**: `daemon`
- **功能**: 启动、停止、查看守护进程状态，管理已加载项目

## 语法

```bash
jls daemon <subcommand> [options]
```

## 子命令

| 子命令 | 说明 |
|--------|------|
| `start` | 启动守护进程 |
| `stop` | 停止守护进程 |
| `status` | 查看守护进程状态 |
| `list` | 列出已加载的项目 |
| `release [project]` | 释放项目内存 |

## 子命令详解

### daemon start

启动 JDT LSP 守护进程。

#### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--port <port>` | 守护进程端口 | `9876` |
| `--eager` | 立即预初始化项目 | `false` |
| `--init-project <path>` | 要预初始化的项目路径 | - |
| `--wait` | 等待初始化完成（与 `--eager` 配合使用） | `false` |

#### 使用示例

```bash
# 基础启动
jls daemon start

# 预初始化模式（推荐）
jls daemon start --eager --init-project E:\mybatis-3-master

# 预初始化并等待完成
jls daemon start --eager --init-project E:\mybatis-3-master --wait

# 指定端口
jls daemon start --port 9877
```

#### 预初始化模式

使用 `--eager` 和 `--init-project` 可以在启动守护进程时立即加载项目，避免首次查询的延迟。

```bash
# 启动并初始化项目（带进度显示）
jls daemon start --eager --init-project E:\mybatis-3-master --wait
```

**输出示例：**
```
启动守护进程... [████████████████████] 100% - 45s
JDT LS 就绪！(45s)
项目：E:\mybatis-3-master
加载耗时：42000ms
PID: 12345
```

### daemon stop

停止正在运行的守护进程。

```bash
jls daemon stop
```

**输出示例：**
```
Daemon stopped (was PID 12345)
```

### daemon status

查看守护进程的运行状态。

```bash
jls daemon status
```

**未运行状态：**
```
Daemon status: NOT RUNNING
Port: 9876

Start with: jls daemon start
```

**运行状态：**
```
Daemon status: RUNNING
PID: 12345
Port: 9876
Project: E:\mybatis-3-master
Status: ready
Uptime: 120s
Version: 1.6.8
```

### daemon list

列出当前已加载到守护进程中的所有项目。

```bash
jls daemon list
```

**输出示例：**
```
Loaded projects (2):
  E:\mybatis-3-master
    Status: ready, Priority: 1, Last access: 30s ago
  E:\spring-boot-project
    Status: ready, Priority: 2, Last access: 120s ago
```

### daemon release

释放已加载项目的内存，优化守护进程资源占用。

#### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `[project]` | string | ❌ | 要释放的项目路径（不指定则释放优先级最低的项目） |

#### 使用示例

```bash
# 释放最近最少使用的项目
jls daemon release

# 释放指定项目
jls daemon release E:\old-project
```

**输出示例：**
```
Project released
```

## 守护进程优势

### 性能对比

| 模式 | 首次命令 | 后续命令 |
|------|----------|----------|
| 守护进程模式 | 30-60秒（启动+索引） | **5-500ms** |
| 直接模式（--no-daemon） | 30-60秒 | 30-60秒 |

### 使用建议

1. **频繁使用**: 始终启用守护进程模式（默认）
2. **项目切换**: 使用 `--eager --init-project` 预加载项目
3. **资源管理**: 定期使用 `daemon list` 和 `daemon release` 管理内存
4. **端口冲突**: 如遇端口占用，使用 `--port` 指定其他端口

## 工作流示例

### 典型工作流

```bash
# 1. 启动守护进程并初始化项目
jls daemon start --eager --init-project E:\mybatis-3-master --wait

# 2. 执行查询（快速响应）
jls find SqlSession --kind Class
jls sym src/main/java/org/apache/ibatis/session/SqlSession.java --flat
jls ch DefaultSqlSession.java --method selectOne -d 3

# 3. 查看状态
jls daemon status

# 4. 工作完成后停止守护进程
jls daemon stop
```

### 多项目管理

```bash
# 1. 启动守护进程
jls daemon start

# 2. 第一个项目会自动加载
jls -p E:\project-a find MyClass

# 3. 切换到第二个项目（也会自动加载）
jls -p E:\project-b find YourClass

# 4. 查看已加载的项目
jls daemon list

# 5. 释放不常用的项目
jls daemon release E:\project-a
```

## 故障排除

### 守护进程无法启动

**症状**: `jls daemon start` 无响应或报错

**解决方法**:
```bash
# 1. 检查端口占用
netstat -ano | findstr 9876

# 2. 强制停止后重启
jls daemon stop
jls daemon start

# 3. 使用其他端口
jls daemon start --port 9877

# 4. 查看日志
type %USERPROFILE%\.jdt-lsp-cli\daemon.log
```

### 守护进程响应慢

**症状**: 命令执行缓慢

**解决方法**:
```bash
# 1. 检查项目状态
jls daemon status

# 2. 重新初始化项目
jls daemon stop
jls daemon start --eager --init-project E:\my-project --wait

# 3. 释放不用的项目
jls daemon list
jls daemon release E:\old-project
```

### 端口冲突

**症状**: 启动时报端口占用错误

**解决方法**:
```bash
# 1. 查找占用端口的进程
netstat -ano | findstr 9876

# 2. 使用其他端口
jls daemon start --port 9877

# 3. 后续命令指定端口
jls --project E:\my-project find MyClass
```

## 相关命令

- [config](config.md) - 管理配置文件
- 所有 LSP 命令都受益于守护进程模式
