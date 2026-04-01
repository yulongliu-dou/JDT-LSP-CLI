/**
 * CLI 工具函数
 */

import * as http from 'http';
import { DAEMON_PORT } from '../../daemon';
import { CLIResult } from '../../core/types';

/**
 * 通过守护进程发送请求
 */
export async function sendDaemonRequest(endpoint: string, body: any): Promise<CLIResult<any>> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: DAEMON_PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 120000,
    }, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve({
            success: false,
            error: `Invalid response from daemon: ${responseData}`,
            elapsed: 0,
          });
        }
      });
    });
    
    req.on('error', (e: any) => {
      if (e.code === 'ECONNREFUSED') {
        resolve({
          success: false,
          error: 'Daemon not running. Start it with: jls daemon start',
          elapsed: 0,
        });
      } else {
        resolve({
          success: false,
          error: `Daemon connection error: ${e.message}`,
          elapsed: 0,
        });
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Daemon request timeout',
        elapsed: 0,
      });
    });
    
    req.write(data);
    req.end();
  });
}
