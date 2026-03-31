#!/usr/bin/env node
/**
 * JDT LSP Daemon Process - 守护进程子进程入口
 * 
 * 此文件作为 child_process.fork 的入口，在后台运行守护进程
 * 通过 IPC 向父进程报告初始化进度
 */

import { startDaemon } from './daemon';

// 从环境变量获取配置
const port = parseInt(process.env.JLS_DAEMON_PORT || '9876');
const eagerInit = process.env.JLS_DAEMON_EAGER === 'true';
const projectPath = process.env.JLS_DAEMON_PROJECT || undefined;
const jdtlsPath = process.env.JLS_DAEMON_JDTLS || undefined;

// 启动守护进程
startDaemon(port, {
  eagerInit,
  projectPath,
  jdtlsPath,
});
