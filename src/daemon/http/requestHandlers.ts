/**
 * HTTP 请求处理工具
 * 
 * 提供 HTTP 请求解析和响应发送的辅助函数
 */

import * as http from 'http';
import { CLIResult } from '../../core/types';

/**
 * 解析请求体
 */
export async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
export function sendResponse<T>(res: http.ServerResponse, result: CLIResult<T>) {
  res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result, null, 2));
}

/**
 * 设置 CORS 头（用于开发调试）
 */
export function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
