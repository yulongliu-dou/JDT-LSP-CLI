/**
 * Maven 依赖解析器（SP04 完善版）
 *
 * 本期新增：
 * - 独立函数 `jarToGAV` / `resolveLocalRepo` / `listDirectDeps`
 * - `resolveLocalRepo`：解析 ~/.m2/settings.xml 自定义仓库路径
 * - `listDirectDeps`：解析 pom.xml 的直接依赖
 *
 * 保留 class 形式向后兼容，委托给同名独立函数。
 *
 * 参见：[SP04 子计划 Task 4.1](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP04-源码获取与CLI配置_d4e5f6a7.md)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GAV } from '../core/types';
import type { DependencyResolver } from './dependencyResolver';

/**
 * 从 jar 绝对路径反解 GAV
 *
 * 规则：
 * - 必须含 `/repository/` 段（大小写无关）
 * - jar 文件名 `<artifactId>-<version>.jar` 必须与父目录的 artifact / version 对应
 * - groupId 由 `repository` 与 artifact 父目录之间的路径段用 `.` 拼接
 */
export function jarToGAV(jarPath: string): GAV | null {
  if (!jarPath) return null;
  const norm = jarPath.replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  const repoIdx = lower.lastIndexOf('/repository/');
  if (repoIdx < 0) return null;

  const relative = norm.slice(repoIdx + '/repository/'.length);
  const parts = relative.split('/').filter(Boolean);
  if (parts.length < 4) return null;

  const fileName = parts[parts.length - 1];
  const version = parts[parts.length - 2];
  const artifactId = parts[parts.length - 3];
  const groupParts = parts.slice(0, parts.length - 3);
  if (groupParts.length === 0) return null;
  const groupId = groupParts.join('.');

  if (!fileName.toLowerCase().endsWith('.jar')) return null;
  const stem = fileName.slice(0, -'.jar'.length);

  const expectedPrefix = `${artifactId}-${version}`;
  if (!stem.startsWith(expectedPrefix)) return null;

  let classifier: string | undefined;
  if (stem.length > expectedPrefix.length) {
    const remainder = stem.slice(expectedPrefix.length);
    if (remainder.startsWith('-')) {
      classifier = remainder.slice(1);
    } else {
      return null;
    }
  }

  return classifier
    ? { groupId, artifactId, version, classifier }
    : { groupId, artifactId, version };
}

/**
 * 解析 Maven 本地仓库路径。
 *
 * 默认 `~/.m2/repository`；若 `~/.m2/settings.xml` 存在 `<localRepository>` 则解析。
 */
export function resolveLocalRepo(): string {
  const m2Dir = path.join(os.homedir(), '.m2');
  const settingsPath = path.join(m2Dir, 'settings.xml');

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      // 简单正则：不引入 XML 解析器依赖
      const m = raw.match(/<localRepository>\s*([^<]+)\s*<\/localRepository>/i);
      if (m && m[1]) {
        // 支持 ~/ 展开
        let repo = m[1].trim();
        if (repo.startsWith('~/')) {
          repo = path.join(os.homedir(), repo.slice(2));
        }
        return path.resolve(repo);
      }
    }
  } catch {
    // ignore
  }

  return path.join(m2Dir, 'repository');
}

/**
 * 解析 pom.xml 的直接 `<dependencies>`（非 test、provided）。
 *
 * 简单 regex 实现，不引入 XML 解析器依赖，足以覆盖标准 pom.xml。
 */
export async function listDirectDeps(workspaceRoot: string): Promise<GAV[]> {
  const pomPath = path.join(workspaceRoot, 'pom.xml');
  if (!fs.existsSync(pomPath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(pomPath, 'utf-8');
  } catch {
    return [];
  }

  // 提取 <dependencies>...</dependencies> 块（取第一个，忽略 <dependencyManagement>）
  // 简单策略：从第一个 <dependencies> 到第一个 </dependencies>
  const depsMatch = raw.match(/<dependencies>\s*([\s\S]*?)\s*<\/dependencies>/i);
  if (!depsMatch) return [];

  const block = depsMatch[1];
  // 匹配每个 <dependency>...</dependency>
  const depRegex = /<dependency>\s*([\s\S]*?)\s*<\/dependency>/gi;
  const result: GAV[] = [];

  let depMatch: RegExpExecArray | null;
  while ((depMatch = depRegex.exec(block)) !== null) {
    const depXml = depMatch[1];

    // 跳过 test / provided scope
    const scopeM = depXml.match(/<scope>\s*(\S+)\s*<\/scope>/i);
    if (scopeM) {
      const scope = scopeM[1].toLowerCase();
      if (scope === 'test' || scope === 'provided') continue;
    }

    // 跳过 optional
    if (/<optional>\s*true\s*<\/optional>/i.test(depXml)) continue;

    // 解析 groupId
    const gM = depXml.match(/<groupId>\s*([^<]+)\s*<\/groupId>/i);
    const aM = depXml.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/i);
    const vM = depXml.match(/<version>\s*([^<]+)\s*<\/version>/i);

    if (!gM || !aM) continue;

    const groupId = gM[1].trim();
    const artifactId = aM[1].trim();
    // version 允许缺失（由父 POM 管理），此时用空字符串占位
    const version = vM ? vM[1].trim() : '';

    result.push({ groupId, artifactId, version });
  }

  return result;
}

export class MavenDependencyResolver implements DependencyResolver {
  readonly kind = 'maven';

  /** 委托到独立函数 jarToGAV */
  jarToGAV(jarPath: string): GAV | null {
    return jarToGAV(jarPath);
  }
}

/**
 * 工具函数：根据 GAV 构建默认的 ~/.m2 下 jar 相对路径
 * （保留给 SP04 下载器使用）
 */
export function gavToJarRelativePath(gav: GAV): string {
  const groupPath = gav.groupId.replace(/\./g, '/');
  const classifierSuffix = gav.classifier ? `-${gav.classifier}` : '';
  return path.posix.join(
    groupPath,
    gav.artifactId,
    gav.version,
    `${gav.artifactId}-${gav.version}${classifierSuffix}.jar`
  );
}
