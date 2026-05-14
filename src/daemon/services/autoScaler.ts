/**
 * AutoScaler — 自动伸缩决策引擎
 *
 * 实现六步决策逻辑（设计文档 3.2 节）：
 *   1. 检查内存监控状态 + 快照时效性
 *   2. 空闲回收（≥2 项目，排除有活跃请求的候选）
 *   3. 内存压力评估 → capacity
 *   4. 容量上限检查（超出 capacity 的标记 draining）
 *   5. 冷却保护（critical 豁免）
 *   6. 执行 — 缩容带 drain，扩容仅 relax_capacity
 *
 * 同时处理守护进程空闲超时交互（设计文档 2.5 节）。
 */

import { MemoryMonitor } from '../core/memoryMonitor';
import { ProjectPool } from '../../projectPool';
import { DaemonConfig, ScaleAction, ScaleDecision, PressureLevel } from '../../core/types';
import { daemonState } from '../core/daemonStateManager';
import { load as loadDaemonConfig } from '../../libraryProvider/daemonConfigStore';

export class AutoScaler {
  private memoryMonitor: MemoryMonitor;
  private projectPool: ProjectPool;
  private config: DaemonConfig;
  private log: (message: string, ...args: any[]) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private latestDecision: ScaleDecision | null = null;
  private lastScaleTime: number = 0;
  private poolEmptiedAt: number | null = null;

  constructor(
    memoryMonitor: MemoryMonitor,
    projectPool: ProjectPool,
    config: DaemonConfig,
    logger?: (message: string, ...args: any[]) => void,
  ) {
    this.memoryMonitor = memoryMonitor;
    this.projectPool = projectPool;
    this.config = config;
    this.log = logger || (() => {});
  }

  get enabled(): boolean {
    // 运行时配置（可热更新）优先于项目级配置
    const runtimeConfig = loadDaemonConfig();
    if (runtimeConfig.autoScaling?.enabled === false) return false;
    return this.config.daemon?.autoScaling?.enabled ?? true;
  }

  /**
   * 返回合并后的 auto-scaling 配置：运行时配置（来自 daemon-config.json）覆盖项目级配置。
   * 设计 3.6: 支持 `jls daemon config --auto-scaling key=value` 热更新。
   */
  private getEffectiveConfig() {
    const project = this.config.daemon?.autoScaling;
    const runtime = loadDaemonConfig().autoScaling;
    if (!runtime) return project;
    return {
      ...project,
      enabled: runtime.enabled ?? project?.enabled,
      maxProjects: runtime.maxProjects ?? project?.maxProjects,
      minProjects: runtime.minProjects ?? project?.minProjects,
    };
  }

  // ========== Lifecycle ==========

  start(intervalMs?: number): void {
    if (this.timer) return;
    const asConfig = this.getEffectiveConfig();
    const interval = intervalMs ?? (asConfig?.checkIntervalSeconds ?? 15) * 1000;

    const run = async () => {
      try {
        await this.evaluate();
      } catch (e: any) {
        this.log('AutoScaler evaluate error:', e?.message || e);
      }
    };

    // Defer first evaluation to let MemoryMonitor collect initial snapshot
    setTimeout(() => run().catch(() => {}), 5000);
    this.timer = setInterval(() => run().catch(() => {}), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ========== Decision Engine ==========

  async evaluate(): Promise<ScaleDecision> {
    const now = Date.now();
    const asConfig = this.getEffectiveConfig();

    // ---- Step 1: Check memory monitor status + snapshot freshness ----
    let degraded = this.memoryMonitor.isDegraded();
    let degradedReason: string | undefined;
    let pressureLevel: PressureLevel = 'unknown';
    let snapshotAgeMs: number | undefined;
    let snapshotStale = false;

    const snapshot = this.memoryMonitor.getLatestSnapshot();
    const consecutiveFailures = this.memoryMonitor.getConsecutiveFailures();

    if (!snapshot) {
      if (consecutiveFailures >= 5) {
        degraded = true;
        degradedReason = 'All memory collection methods failed';
      }
    } else {
      snapshotAgeMs = now - snapshot.timestamp;
      const maxAge = asConfig?.maxSnapshotAgeMs ?? 60000;

      if (snapshotAgeMs > maxAge) {
        // Force a synchronous collection
        try {
          const fresh = await this.memoryMonitor.getMemorySnapshot();
          if (fresh.error) {
            snapshotStale = true;
          } else {
            snapshotAgeMs = Date.now() - fresh.timestamp;
            if (snapshotAgeMs <= maxAge) {
              pressureLevel = this.memoryMonitor.getPressureLevel(fresh);
            } else {
              snapshotStale = true;
            }
          }
        } catch {
          snapshotStale = true;
        }
      }

      if (!snapshotStale && pressureLevel === 'unknown') {
        pressureLevel = this.memoryMonitor.getPressureLevel();
      }
    }

    // ---- Step 2: Idle eviction (both normal and degraded mode) ----
    let action: ScaleAction = { action: 'none', reason: '' };
    const currentCount = this.projectPool.size;

    if (currentCount >= 2) {
      const idleEvictMs = (asConfig?.idleEvictMinutes ?? 30) * 60 * 1000;
      const projects = this.projectPool.listProjects();

      for (const proj of projects) {
        if (now - proj.lastAccess <= idleEvictMs) continue;
        if (this.projectPool.getActiveRequestCount(proj.path) > 0) continue;
        if (this.projectPool.isDraining(proj.path)) continue;

        action = {
          action: 'evict_idle',
          reason: `idle for ${Math.floor((now - proj.lastAccess) / 60000)}min`,
          targetProject: proj.path,
        };
        break;
      }
    }

    // ---- Step 3: Memory pressure → capacity ----
    const effectiveMax = this.getEffectiveMaxProjects();
    let capacity = this.latestDecision?.capacity ?? currentCount;

    if (!degraded && !snapshotStale && pressureLevel !== 'unknown') {
      switch (pressureLevel) {
        case 'low':
          capacity = Math.min(capacity + 1, effectiveMax);
          break;
        case 'moderate':
          // Keep current capacity
          break;
        case 'high':
          capacity = Math.max(capacity - 1, asConfig?.minProjects ?? 1);
          break;
        case 'critical':
          capacity = asConfig?.minProjects ?? 1;
          break;
      }
    }

    // ---- Step 4: Capacity check ----
    if (currentCount > capacity && action.action === 'none') {
      const projects = this.projectPool.listProjects();
      const candidates = projects
        .filter(p => !this.projectPool.isDraining(p.path) && this.projectPool.getActiveRequestCount(p.path) === 0)
        .sort((a, b) => a.priority - b.priority || a.lastAccess - b.lastAccess);

      if (candidates.length > 0) {
        // Min-project protection: don't evict the last project even under pressure
        if (currentCount <= (asConfig?.minProjects ?? 1)) {
          daemonState.warnings.push(
            `minProjects protection: refusing to shrink below ${asConfig?.minProjects ?? 1} (pressure: ${pressureLevel})`
          );
        } else {
          action = {
            action: 'shrink',
            reason: `pressure ${pressureLevel}, capacity ${capacity} < count ${currentCount}`,
            targetProject: candidates[0].path,
          };
        }
      }
    } else if (capacity > currentCount && action.action === 'none') {
      action = {
        action: 'relax_capacity',
        reason: `pressure ${pressureLevel}, capacity relaxed to ${capacity}`,
      };
    }

    // ---- Step 5: Cooldown protection (critical & evict_idle exempt) ----
    // Only shrink is gated by cooldown — evict_idle targets long-idle projects and
    // should never be blocked by a recent shrink.
    if (action.action === 'shrink' && pressureLevel !== 'critical') {
      const cooldownMs = (asConfig?.scaleCooldownSeconds ?? 30) * 1000;
      if (now - this.lastScaleTime < cooldownMs) {
        action = { action: 'none', reason: `cooldown (would have: shrink)` };
      }
    }

    // ---- Step 6: Execute shrink/evict ----
    const isScaleAction = action.action === 'shrink' || action.action === 'evict_idle';
    if (isScaleAction && action.action !== 'none' && action.targetProject) {
      await this.executeShrink(action.targetProject, asConfig?.drainTimeoutMs ?? 5000);
      if (action.action === 'shrink') {
        this.lastScaleTime = Date.now();
      }

      // After release, reset poolEmptiedAt if pool is now empty
      if (this.projectPool.size === 0) {
        if (!this.poolEmptiedAt) {
          this.poolEmptiedAt = Date.now();
        }
      }
    }

    // ---- Stalled index detection ----
    daemonState.checkStalled();

    // ---- Daemon idle timeout (design doc 2.5) ----
    const idleTimeoutMinutes = this.config.daemon?.idleTimeoutMinutes ?? 30;
    if (idleTimeoutMinutes > 0) {
      if (this.projectPool.size === 0) {
        if (!this.poolEmptiedAt) {
          this.poolEmptiedAt = Date.now();
        } else if (Date.now() - this.poolEmptiedAt > idleTimeoutMinutes * 60 * 1000) {
          this.log('Daemon idle timeout: pool empty for', idleTimeoutMinutes, 'minutes, shutting down');
          // Graceful shutdown via process exit
          setTimeout(() => process.exit(0), 500);
        }
      } else {
        this.poolEmptiedAt = null;
      }
    }

    // ---- Build decision ----
    const decision: ScaleDecision = {
      timestamp: now,
      degraded,
      degradedReason,
      currentCount,
      capacity,
      pressureLevel,
      action,
      snapshotAgeMs,
      snapshotStale,
    };

    this.latestDecision = decision;
    return decision;
  }

  getLatestDecision(): ScaleDecision | null {
    return this.latestDecision;
  }

  // ========== Private helpers ==========

  /**
   * Compute effective max projects.
   * If user explicitly set maxProjects > 3, trust their config.
   * Otherwise default ceiling is 3.
   */
  private getEffectiveMaxProjects(): number {
    const configured = this.config.daemon?.maxProjects ?? 1;
    const autoScalingMax = this.config.daemon?.autoScaling?.maxProjects ?? 3;
    if (configured > 3) return configured;
    return autoScalingMax;
  }

  /**
   * Execute shrink/evict with drain mechanism.
   * 1. Mark project draining
   * 2. Wait for activeRequests to reach 0 (poll at 200ms intervals)
   * 3. Release project (force release on timeout)
   */
  private async executeShrink(projectPath: string, drainTimeoutMs: number): Promise<void> {
    this.log('AutoScaler: draining project', projectPath);

    const marked = this.projectPool.markDraining(projectPath);
    if (!marked) {
      this.log('AutoScaler: project not found for drain', projectPath);
      return;
    }

    const start = Date.now();
    const pollMs = 200;

    while (Date.now() - start < drainTimeoutMs) {
      const active = this.projectPool.getActiveRequestCount(projectPath);
      if (active === 0) {
        this.log('AutoScaler: drain complete, releasing', projectPath);
        await this.projectPool.releaseProject(projectPath);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    // Timeout: force release
    const remaining = this.projectPool.getActiveRequestCount(projectPath);
    this.log(`AutoScaler: drain timeout (${drainTimeoutMs}ms), force releasing ${projectPath} (${remaining} in-flight)`);
    daemonState.warnings.push(`Force release of ${projectPath} with ${remaining} in-flight requests`);
    await this.projectPool.releaseProject(projectPath);
  }

  /**
   * Notify AutoScaler that a new project loaded — reset poolEmptiedAt.
   * Called by routeHandlers when initClient creates a new project.
   */
  notifyProjectActivity(): void {
    this.poolEmptiedAt = null;
  }
}
