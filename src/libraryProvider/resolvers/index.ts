/**
 * DependencyResolver 注册表
 *
 * 按 kind 注册 / 查询；默认内置 Maven。
 *
 * 参见：[SP01 子计划 Task 1.1](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

import type { DependencyResolver } from './dependencyResolver';
import { MavenDependencyResolver } from './mavenDependencyResolver';

const registry = new Map<string, DependencyResolver>();

/** 初始化：注册默认 resolver */
function ensureInitialized(): void {
  if (registry.size === 0) {
    registry.set('maven', new MavenDependencyResolver());
  }
}

/**
 * 注册自定义 resolver（会覆盖同 kind 的旧注册）
 */
export function registerResolver(resolver: DependencyResolver): void {
  ensureInitialized();
  registry.set(resolver.kind, resolver);
}

/**
 * 按 kind 获取 resolver
 */
export function getResolver(kind: string): DependencyResolver | undefined {
  ensureInitialized();
  return registry.get(kind);
}

/**
 * 获取所有已注册 resolver（按注册顺序）
 */
export function listResolvers(): DependencyResolver[] {
  ensureInitialized();
  return Array.from(registry.values());
}

/**
 * 对一个 jar 路径，依次尝试所有 resolver 做 jarToGAV，取第一个命中结果。
 */
export function resolveGavFromJar(jarPath: string): {
  kind: string;
  gav: { groupId: string; artifactId: string; version: string; classifier?: string };
} | null {
  ensureInitialized();
  for (const r of registry.values()) {
    const gav = r.jarToGAV(jarPath);
    if (gav) {
      return { kind: r.kind, gav };
    }
  }
  return null;
}
