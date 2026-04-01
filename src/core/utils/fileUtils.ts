/**
 * 文件工具函数
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 确保目录存在，如不存在则创建
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 读取文件内容，如不存在返回 null
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    return null;
  }
}

/**
 * 写入 JSON 文件（格式化）
 */
export function writeJsonFile<T>(filePath: string, data: T): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 读取 JSON 文件
 */
export function readJsonFile<T>(filePath: string): T | null {
  const content = readFileSafe(filePath);
  if (!content) return null;
  
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

/**
 * 检查文件是否存在
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * 获取文件的绝对路径
 */
export function resolvePath(filePath: string, basePath?: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return basePath ? path.resolve(basePath, filePath) : path.resolve(filePath);
}

/**
 * 获取 Java 项目根目录（查找 pom.xml 或 build.gradle）
 */
export function findProjectRoot(startPath: string): string | null {
  let currentPath = startPath;
  
  while (currentPath !== path.parse(currentPath).root) {
    // 检查 Maven 项目
    if (fs.existsSync(path.join(currentPath, 'pom.xml'))) {
      return currentPath;
    }
    
    // 检查 Gradle 项目
    if (fs.existsSync(path.join(currentPath, 'build.gradle')) || 
        fs.existsSync(path.join(currentPath, 'build.gradle.kts'))) {
      return currentPath;
    }
    
    currentPath = path.dirname(currentPath);
  }
  
  return null;
}
