/**
 * Lombok JAR 自动检测
 *
 * 从项目的 Maven/Gradle 依赖缓存中查找 lombok.jar，
 * 供 JDT LS 启动时添加 -javaagent 参数。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 在 Maven 本地仓库中查找所有 lombok JAR（按版本降序）
 */
function findMavenLombokJars(): string[] {
  const m2Repo = path.join(os.homedir(), '.m2', 'repository', 'org', 'projectlombok', 'lombok');
  if (!fs.existsSync(m2Repo)) return [];

  const results: { version: string; jarPath: string }[] = [];
  try {
    const versions = fs.readdirSync(m2Repo);
    for (const version of versions) {
      const versionDir = path.join(m2Repo, version);
      if (!fs.statSync(versionDir).isDirectory()) continue;
      const jarFile = path.join(versionDir, `lombok-${version}.jar`);
      if (fs.existsSync(jarFile)) {
        results.push({ version, jarPath: jarFile });
      }
    }
  } catch { /* skip */ }

  results.sort((a, b) => versionCompare(b.version, a.version));
  return results.map(r => r.jarPath);
}

/**
 * 在 Gradle 缓存中查找所有 lombok JAR
 */
function findGradleLombokJars(): string[] {
  const gradleCache = path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'org.projectlombok', 'lombok');
  if (!fs.existsSync(gradleCache)) return [];

  const results: { version: string; jarPath: string }[] = [];
  try {
    const versions = fs.readdirSync(gradleCache);
    for (const version of versions) {
      const versionDir = path.join(gradleCache, version);
      if (!fs.statSync(versionDir).isDirectory()) continue;
      // Gradle 缓存结构: <version>/<hash>/lombok-<version>.jar
      const hashDirs = fs.readdirSync(versionDir);
      for (const hashDir of hashDirs) {
        const jarFile = path.join(versionDir, hashDir, `lombok-${version}.jar`);
        if (fs.existsSync(jarFile)) {
          results.push({ version, jarPath: jarFile });
          break;
        }
      }
    }
  } catch { /* skip */ }

  results.sort((a, b) => versionCompare(b.version, a.version));
  return results.map(r => r.jarPath);
}

/**
 * 简单语义版本比较：返回正数表示 a > b
 */
function versionCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * 从项目中自动检测 lombok.jar 路径
 *
 * 搜索顺序: Maven 本地仓库 → Gradle 缓存
 * 返回最新版本的 JAR 路径，未找到返回 null
 */
export function findLombokJar(): string | null {
  const mavenJars = findMavenLombokJars();
  if (mavenJars.length > 0) return mavenJars[0];

  const gradleJars = findGradleLombokJars();
  if (gradleJars.length > 0) return gradleJars[0];

  return null;
}
