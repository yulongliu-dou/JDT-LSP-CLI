#!/usr/bin/env node
/**
 * JDT LSP Daemon Process - 守护进程子进程入口
 *
 * 此文件作为 child_process.fork 的入口，在后台运行守护进程
 * 通过 IPC 向父进程报告初始化进度
 */

import { startDaemon } from './daemon';
import { validatePort } from './core/utils/daemonValidation';

/**
 * 安全发送 IPC 消息，通道断开时静默忽略
 */
function safeIpcSend(msg: { type: string; data: any }): void {
  if (!process.send) return;
  try {
    process.send(msg);
  } catch {
    // IPC 通道已断开，静默忽略
  }
}

// 从环境变量获取配置
const portStr = process.env.JLS_DAEMON_PORT || '9876';
const portCheck = validatePort(portStr);
if (!portCheck.valid) {
  console.error(`❌ 守护进程启动失败: ${portCheck.error}`);
  if (portCheck.suggestion) {
    console.error(`💡 ${portCheck.suggestion}`);
  }
  safeIpcSend({
    type: 'error',
    data: { error: portCheck.error, port: portStr },
  });
  process.exit(1);
}
const port = parseInt(portStr, 10);

const eagerInit = process.env.JLS_DAEMON_EAGER === 'true';
const projectPath = process.env.JLS_DAEMON_PROJECT || undefined;
const jdtlsPath = process.env.JLS_DAEMON_JDTLS || undefined;

// 启动守护进程
startDaemon(port, {
  eagerInit,
  projectPath,
  jdtlsPath,
}).catch((err) => {
  console.error('❌ 守护进程启动异常:', err.message || err);
  safeIpcSend({
    type: 'error',
    data: { error: err.message || String(err) },
  });
  process.exit(1);
});
