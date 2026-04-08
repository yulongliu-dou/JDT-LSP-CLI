/**
 * 诊断服务
 * 
 * 提供智能项目路径诊断功能
 */

import * as fs from 'fs';
import * as path from 'path';
import { daemonState } from '../core/daemonStateManager';

/**
 * 智能项目路径诊断
 * 当请求的项目路径与守护进程初始化的项目不匹配时，提供详细的诊断信息
 */
export function diagnoseProjectMismatch(params: any, requestedProject: string) {
  const filePath = params?.file;
  const currentProject = daemonState.getCurrentProject();
  
  const diagnosis: any = {
    daemon_project: currentProject,
    requested_project: requestedProject,
    file_path: filePath || null,
    suggested_project: null as string | null,
    confidence: 'low' as 'low' | 'medium' | 'high',
    reason: '',
  };

  // 策略 1：如果文件路径在守护进程的项目目录下，建议使用守护进程的项目
  if (filePath && currentProject) {
    const normalizedFile = path.resolve(filePath);
    const normalizedDaemon = path.resolve(currentProject);
    
    if (normalizedFile.startsWith(normalizedDaemon)) {
      diagnosis.suggested_project = currentProject;
      diagnosis.confidence = 'high';
      diagnosis.reason = `File is located within daemon's project directory (${currentProject})`;
      return diagnosis;
    }
  }

  // 策略 2：如果请求的项目路径存在且包含 Java 文件，建议使用请求的项目
  if (requestedProject && fs.existsSync(requestedProject)) {
    const hasJavaFiles = fs.existsSync(path.join(requestedProject, 'pom.xml')) ||
                         fs.existsSync(path.join(requestedProject, 'build.gradle')) ||
                         fs.existsSync(path.join(requestedProject, '.project'));
    
    if (hasJavaFiles) {
      diagnosis.suggested_project = requestedProject;
      diagnosis.confidence = 'medium';
      diagnosis.reason = `Requested project exists and appears to be a valid Java project`;
      return diagnosis;
    }
  }

  // 策略 3：无法推断
  diagnosis.reason = 'Unable to determine the correct project path';
  return diagnosis;
}
