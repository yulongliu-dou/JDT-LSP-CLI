/**
 * 项目管理服务
 * 
 * 负责 JDT LS 客户端的初始化、复用和切换
 */

import * as os from 'os';
import * as path from 'path';
import { JdtLsClient } from '../../jdtClient';
import { CLIOptions, InitStage } from '../../core/types';
import { ProjectLoadEvent } from '../../projectPool';
import { daemonState } from '../core/daemonStateManager';

/**
 * 初始化 JDT LS 客户端（支持多项目模式）
 * @returns 客户端和加载事件信息
 */
export async function initClient(projectPath: string, options: Partial<CLIOptions> = {}): Promise<{ client: JdtLsClient; loadEvent?: ProjectLoadEvent }> {
  const projectPool = daemonState.getProjectPool();
  
  // 多项目模式：使用 ProjectPool
  if (projectPool) {
    daemonState.updateProgress('starting', 0, '开始初始化项目...');
    const result = await projectPool.getClient(projectPath, options);
    daemonState.setLastLoadEvent(result.loadEvent);
    if (result.loadEvent?.type === 'new' || result.loadEvent?.type === 'reloaded') {
      daemonState.updateProgress('ready', 100, '项目就绪', undefined);
    }
    return result;
  }
  
  // 单项目模式（向后兼容）
  const client = daemonState.getClient();
  const isReady = daemonState.isClientReady();
  const currentProject = daemonState.getCurrentProject();
  
  // 如果项目路径相同且已初始化，复用现有客户端
  if (client && isReady && currentProject === projectPath) {
    daemonState.log('Reusing existing client for project:', projectPath);
    daemonState.setLastLoadEvent({ type: 'reused', projectPath });
    return { client, loadEvent: daemonState.getLastLoadEvent() };
  }
  
  // 如果项目路径不同，先关闭旧客户端
  const evictedProject = currentProject;
  if (client && currentProject !== projectPath) {
    daemonState.log('Project changed, reinitializing client...');
    daemonState.updateProgress('starting', 0, '切换项目，重新初始化...');
    await client.stop();
    daemonState.setClient(null);
    daemonState.setClientReady(false);
    
    // 清理调用链服务实例，因为cursor是与项目相关的
    daemonState.setCallHierarchyService(null, null);
    daemonState.log('Cleared callHierarchyService due to project change');
  }
  
  let activeClient = daemonState.getClient();
  
  if (!activeClient) {
    daemonState.log('Initializing JDT LS client for project:', projectPath);
    daemonState.setInitStartTime(Date.now());
    daemonState.updateProgress('starting', 5, '准备启动 JDT LS...');
    
    // 使用固定的数据目录，便于复用索引缓存
    const dataDir = path.join(os.homedir(), '.jdt-lsp-cli', 'data', 
      Buffer.from(projectPath).toString('base64').replace(/[/+=]/g, '_').slice(0, 50));
    
    daemonState.updateProgress('jdt-launching', 15, '启动 JDT Language Server...');
    
    activeClient = new JdtLsClient({
      projectPath,
      dataDir,
      timeout: options.timeout || 120000,
      verbose: options.verbose || false,
      jdtlsPath: options.jdtlsPath,
    });
    
    daemonState.setClient(activeClient);
    daemonState.setCurrentProject(projectPath);
    
    // 设置进度回调
    activeClient.setProgressCallback((stage: string, percent: number, message: string) => {
      const mappedStage: InitStage = stage === 'initializing' ? 'initializing' : 
                                     stage === 'indexing' ? 'indexing' : 'starting';
      daemonState.updateProgress(mappedStage, percent, message);
    });
    
    try {
      daemonState.updateProgress('initializing', 30, '初始化 LSP 连接...');
      await activeClient.start();
      daemonState.setClientReady(true);
      const loadTime = Date.now() - daemonState.getInitStartTime();
      daemonState.setLastLoadEvent({ 
        type: evictedProject ? 'reloaded' : 'new', 
        projectPath, 
        loadTime,
        evictedProject: evictedProject || undefined
      });
      daemonState.updateProgress('ready', 100, 'JDT LS 就绪', undefined);
      daemonState.log('JDT LS client ready for project:', projectPath, `(loaded in ${loadTime}ms)`);
    } catch (error: any) {
      daemonState.updateProgress('error', 0, '初始化失败', error.message);
      daemonState.log('Failed to initialize JDT LS:', error.message);
      daemonState.setClient(null);
      throw error;
    }
  }
  
  return { client: activeClient, loadEvent: daemonState.getLastLoadEvent() };
}
