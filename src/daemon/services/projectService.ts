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
 * in-flight 初始化 Promise 缓存
 * 避免在单个项目的初始化过程中被多次并发调用（
 * 例如 eager init 还未完成时请求已抵达），
 * 从而出现返回未就绪 client 的问题。
 */
const inFlightInitializations = new Map<string, Promise<{ client: JdtLsClient; loadEvent?: ProjectLoadEvent }>>();

/**
 * 初始化 JDT LS 客户端（支持多项目模式）
 * @returns 客户端和加载事件信息
 */
export async function initClient(projectPath: string, options: Partial<CLIOptions> = {}): Promise<{ client: JdtLsClient; loadEvent?: ProjectLoadEvent }> {
  const projectPool = daemonState.getProjectPool();
  
  // 多项目模式：使用 ProjectPool（内部已自行管理并发）
  if (projectPool) {
    daemonState.updateProgress('starting', 0, '开始初始化项目...');
    const result = await projectPool.getClient(projectPath, options);
    daemonState.setLastLoadEvent(result.loadEvent);
    if (result.loadEvent?.type === 'new' || result.loadEvent?.type === 'reloaded') {
      daemonState.updateProgress('ready', 100, '项目就绪', undefined);
    }
    return result;
  }
  
  // 单项目模式（向后兼容）：
  // 1) 如果已就绪且项目路径相同 → 直接复用
  const existing = daemonState.getClient();
  if (existing && daemonState.isClientReady() && daemonState.getCurrentProject() === projectPath) {
    daemonState.log('Reusing existing client for project:', projectPath);
    daemonState.setLastLoadEvent({ type: 'reused', projectPath });
    return { client: existing, loadEvent: daemonState.getLastLoadEvent() };
  }

  // 2) 如果该项目的初始化已在进行中 → 复用 Promise
  const inFlight = inFlightInitializations.get(projectPath);
  if (inFlight) {
    daemonState.log('Init in-flight, awaiting existing initialization for:', projectPath);
    return inFlight;
  }

  // 3) 当前无并发初始化 → 发起新初始化，缓存 Promise
  const initPromise = doInitClient(projectPath, options).finally(() => {
    inFlightInitializations.delete(projectPath);
  });
  inFlightInitializations.set(projectPath, initPromise);
  return initPromise;
}

/**
 * 实际执行单项目模式的客户端初始化（不含 in-flight 缓存逻辑）
 */
async function doInitClient(projectPath: string, options: Partial<CLIOptions>): Promise<{ client: JdtLsClient; loadEvent?: ProjectLoadEvent }> {
  const client = daemonState.getClient();
  const currentProject = daemonState.getCurrentProject();
  
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
