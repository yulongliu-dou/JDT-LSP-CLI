/**
 * JDT LSP CLI - 程序化调用入口
 * 
 * 可作为库使用:
 * 
 * ```typescript
 * import { JdtLsClient } from 'jdt-lsp-cli';
 * 
 * const client = new JdtLsClient({ projectPath: '/path/to/java/project' });
 * await client.start();
 * 
 * const hierarchy = await client.prepareCallHierarchy('/path/to/File.java', 10, 5);
 * console.log(hierarchy);
 * 
 * await client.stop();
 * ```
 * 
 * 守护进程模式:
 * 
 * ```typescript
 * import { startDaemon, getDaemonStatus, stopDaemon } from 'jdt-lsp-cli';
 * 
 * startDaemon(9876);  // 启动守护进程
 * getDaemonStatus();  // 获取状态
 * stopDaemon();       // 停止守护进程
 * ```
 */

export { JdtLsClient } from './jdtClient';
export { startDaemon, getDaemonStatus, stopDaemon, DAEMON_PORT, DAEMON_PID_FILE } from './daemon';
export * from './types';
