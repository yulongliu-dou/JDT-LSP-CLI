/**
 * 日志工具
 */

import * as fs from 'fs';
import * as path from 'path';
import { LOG_FILE_NAME } from './constants';

let logFilePath: string | null = null;

/**
 * 获取日志文件路径
 */
export function getLogFilePath(): string {
  if (!logFilePath) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    logFilePath = path.join(homeDir, LOG_FILE_NAME);
  }
  return logFilePath;
}

/**
 * 确保日志目录存在
 */
function ensureLogDir(): void {
  const logDir = path.dirname(getLogFilePath());
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * 写入日志到文件
 */
export function writeLog(message: string): void {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(getLogFilePath(), logLine);
  } catch (error) {
    // 忽略日志写入错误
  }
}

/**
 * 通用日志函数
 */
export function log(message: string, ...args: any[]): void {
  const formattedArgs = args.map(a => JSON.stringify(a)).join(' ');
  const fullMessage = `${message} ${formattedArgs}`.trim();
  
  // 写入文件
  writeLog(fullMessage);
  
  // 输出到控制台
  console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

/**
 * 错误日志
 */
export function error(message: string, ...args: any[]): void {
  const formattedArgs = args.map(a => JSON.stringify(a)).join(' ');
  const fullMessage = `[ERROR] ${message} ${formattedArgs}`.trim();
  
  writeLog(fullMessage);
  console.error(`[${new Date().toISOString()}] ${message}`, ...args);
}

/**
 * 调试日志（仅在 verbose 模式下输出）
 */
export function debug(message: string, verbose: boolean, ...args: any[]): void {
  if (verbose) {
    log(`[DEBUG] ${message}`, ...args);
  }
}
