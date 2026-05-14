/**
 * MemoryMonitor — 平台内存监控
 *
 * 系统级内存采集（macOS memory_pressure / Windows Performance Counter）
 * + 进程级 RSS 采集。
 * 含快照时效性、三级重试降级、连续失败 → degraded 自愈恢复。
 */

import { exec } from 'child_process';
import * as os from 'os';
import { MemorySnapshot, PressureLevel, ProjectMemorySnapshot } from '../../core/types';

function execAsync(command: string, timeoutMs: number = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export class MemoryMonitor {
  private snapshot: MemorySnapshot | null = null;
  private consecutiveFailures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private maxSnapshotAgeMs: number;
  private collectionTimeoutMs: number;

  constructor(maxSnapshotAgeMs: number = 60000, collectionTimeoutMs: number = 10000) {
    this.maxSnapshotAgeMs = maxSnapshotAgeMs;
    this.collectionTimeoutMs = collectionTimeoutMs;
  }

  // ========== Platform Detection ==========

  static isMacOS(): boolean {
    return process.platform === 'darwin';
  }

  static isWindows(): boolean {
    return process.platform === 'win32';
  }

  // ========== System Memory ==========

  async getMemorySnapshot(): Promise<MemorySnapshot> {
    if (MemoryMonitor.isMacOS()) {
      return this.collectMacOS();
    }
    if (MemoryMonitor.isWindows()) {
      return this.collectWindows();
    }
    // Linux / other: fallback to Node.js
    return this.collectNodeOs();
  }

  private async collectMacOS(): Promise<MemorySnapshot> {
    const startTime = Date.now();

    // L1: memory_pressure
    try {
      const output = await execAsync('memory_pressure', this.collectionTimeoutMs);
      const snapshot = this.parseMemoryPressure(output, startTime);
      if (snapshot) return snapshot;
    } catch { /* fall through */ }

    // L2: sysctl swap
    try {
      const swapOut = await execAsync('sysctl -n vm.swapusage', this.collectionTimeoutMs);
      const snapshot = this.parseSwapUsage(swapOut, startTime);
      if (snapshot) return snapshot;
    } catch { /* fall through */ }

    // L3: Node.js
    try {
      return this.collectNodeOs();
    } catch (e: any) {
      return this.errorSnapshot('darwin', e);
    }
  }

  private parseMemoryPressure(output: string, startTime: number): MemorySnapshot | null {
    // Parse page size
    const pageSizeMatch = output.match(/page size of (\d+)/);
    const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;

    // Parse page counts
    const pageCounts: Record<string, number> = {};
    const pageRegex = /^Pages ([\w\s-]+):\s+(\d+)/gm;
    let match: RegExpExecArray | null;
    while ((match = pageRegex.exec(output)) !== null) {
      pageCounts[match[1].trim()] = parseInt(match[2], 10);
    }

    const free = pageCounts['free'] || 0;
    const active = pageCounts['active'] || 0;
    const inactive = pageCounts['inactive'] || 0;
    const wired = pageCounts['wired down'] || 0;

    // Calculate free MB and total from available pages
    const freeMB = (free * pageSize) / (1024 * 1024);
    const totalPages = free + active + inactive + wired + (pageCounts['speculative'] || 0);
    const totalMB = (totalPages * pageSize) / (1024 * 1024);

    // Parse swapouts
    const swapoutsMatch = output.match(/^Swapouts:\s+(\d+)/m);
    const swapouts = swapoutsMatch ? parseInt(swapoutsMatch[1], 10) : 0;
    const swapUsedMB = swapouts > 0 ? 1 : undefined; // presence of swapouts → sentinel 1 to trigger swapMB > 0 → high

    // Parse free percentage (macOS 12+)
    const freePercentMatch = output.match(/System-wide memory free percentage:\s+([\d.]+)%/);
    const memoryPressureFreePercent = freePercentMatch ? parseFloat(freePercentMatch[1]) : undefined;

    const usedPercent = totalMB > 0 ? ((totalMB - freeMB) / totalMB) * 100 : 0;

    return {
      platform: 'darwin',
      timestamp: Date.now(),
      totalMB: Math.round(totalMB),
      freeMB: Math.round(freeMB),
      usedPercent: Math.round(usedPercent * 100) / 100,
      pageSize,
      swapUsedMB,
      memoryPressureFreePercent,
      source: 'memory_pressure',
      collectionDurationMs: Date.now() - startTime,
    };
  }

  private parseSwapUsage(output: string, startTime: number): MemorySnapshot | null {
    // sysctl vm.swapusage format: "total = 1024.00M  used = 512.00M  free = 512.00M"
    const totalMatch = output.match(/total = ([\d.]+)([MG])/);
    const usedMatch = output.match(/used = ([\d.]+)([MG])/);

    if (!totalMatch || !usedMatch) return null;

    const totalVal = parseFloat(totalMatch[1]) * (totalMatch[2] === 'G' ? 1024 : 1);
    const usedVal = parseFloat(usedMatch[1]) * (usedMatch[2] === 'G' ? 1024 : 1);

    const totalMB = os.totalmem() / (1024 * 1024);
    const freeMB = os.freemem() / (1024 * 1024);

    return {
      platform: 'darwin',
      timestamp: Date.now(),
      totalMB: Math.round(totalMB),
      freeMB: Math.round(freeMB),
      usedPercent: Math.round(((totalMB - freeMB) / totalMB) * 10000) / 100,
      swapUsedMB: Math.round(usedVal),
      source: 'sysctl_swap',
      collectionDurationMs: Date.now() - startTime,
    };
  }

  private async collectWindows(): Promise<MemorySnapshot> {
    const startTime = Date.now();

    // L1: Performance Counter
    try {
      const cmd = `powershell -NoProfile -Command "Get-Counter '\\Memory\\Available MBytes','\\Memory\\% Committed Bytes In Use' | Select-Object -ExpandProperty CounterSamples | ForEach-Object { $_.Path + '=' + $_.CookedValue }"`;
      const output = await execAsync(cmd, this.collectionTimeoutMs);
      const snapshot = this.parsePerfCounter(output, startTime);
      if (snapshot) return snapshot;
    } catch { /* fall through */ }

    // L2: CimInstance
    try {
      const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ForEach-Object { 'total=' + $_.TotalVisibleMemorySize + ';free=' + $_.FreePhysicalMemory }"`;
      const output = await execAsync(cmd, this.collectionTimeoutMs);
      const snapshot = this.parseCimInstance(output, startTime);
      if (snapshot) return snapshot;
    } catch { /* fall through */ }

    // L3: Node.js
    try {
      return this.collectNodeOs();
    } catch (e: any) {
      return this.errorSnapshot('win32', e);
    }
  }

  private parsePerfCounter(output: string, startTime: number): MemorySnapshot | null {
    const availableMatch = output.match(/available mbytes[=:]\s*([\d.]+)/i);
    const commitMatch = output.match(/committed bytes in use[=:]\s*([\d.]+)/i);

    if (!availableMatch) return null;

    const availableMB = parseFloat(availableMatch[1]);
    const commitPercent = commitMatch ? parseFloat(commitMatch[1]) : undefined;
    const totalMB = os.totalmem() / (1024 * 1024);

    return {
      platform: 'win32',
      timestamp: Date.now(),
      totalMB: Math.round(totalMB),
      freeMB: Math.round(availableMB),
      usedPercent: Math.round(((totalMB - availableMB) / totalMB) * 10000) / 100,
      availableMB: Math.round(availableMB),
      commitPercent: commitPercent ? Math.round(commitPercent * 100) / 100 : undefined,
      source: 'perf_counter',
      collectionDurationMs: Date.now() - startTime,
    };
  }

  private parseCimInstance(output: string, startTime: number): MemorySnapshot | null {
    const totalMatch = output.match(/total=(\d+)/);
    const freeMatch = output.match(/free=(\d+)/);

    if (!totalMatch || !freeMatch) return null;

    // Values are in KB
    const totalMB = parseInt(totalMatch[1], 10) / 1024;
    const freeMB = parseInt(freeMatch[1], 10) / 1024;

    return {
      platform: 'win32',
      timestamp: Date.now(),
      totalMB: Math.round(totalMB),
      freeMB: Math.round(freeMB),
      usedPercent: Math.round(((totalMB - freeMB) / totalMB) * 10000) / 100,
      availableMB: Math.round(freeMB),
      source: 'cim_instance',
      collectionDurationMs: Date.now() - startTime,
    };
  }

  private collectNodeOs(): MemorySnapshot {
    const startTime = Date.now();
    const totalMB = os.totalmem() / (1024 * 1024);
    const freeMB = os.freemem() / (1024 * 1024);
    const platform = process.platform === 'darwin' ? 'darwin' as const : 'win32' as const;

    return {
      platform,
      timestamp: Date.now(),
      totalMB: Math.round(totalMB),
      freeMB: Math.round(freeMB),
      usedPercent: Math.round(((totalMB - freeMB) / totalMB) * 10000) / 100,
      source: 'node_os',
      collectionDurationMs: Date.now() - startTime,
    };
  }

  private errorSnapshot(platform: 'darwin' | 'win32', e: Error): MemorySnapshot {
    return {
      platform,
      timestamp: Date.now(),
      totalMB: 0,
      freeMB: 0,
      usedPercent: 0,
      source: 'node_os',
      error: `All collection levels failed: ${e?.message || e}`,
    };
  }

  // ========== Snapshot Freshness ==========

  getLatestSnapshot(): MemorySnapshot | null {
    return this.snapshot;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  isSnapshotStale(): boolean {
    if (!this.snapshot) return true;
    return Date.now() - this.snapshot.timestamp > this.maxSnapshotAgeMs;
  }

  isDegraded(): boolean {
    return this.consecutiveFailures >= 5;
  }

  getPressureLevel(snapshot?: MemorySnapshot): PressureLevel {
    const s = snapshot ?? this.snapshot;
    if (!s || s.error) return 'unknown';
    // Only check staleness for the cached snapshot, not a caller-provided one
    if (!snapshot && this.isSnapshotStale()) return 'unknown';

    if (s.platform === 'darwin') {
      return this.macOSPressureLevel(s);
    }
    return this.windowsPressureLevel(s);
  }

  private macOSPressureLevel(s: MemorySnapshot): PressureLevel {
    const freePercent = s.memoryPressureFreePercent ?? (s.totalMB > 0 ? (s.freeMB / s.totalMB) * 100 : 0);
    const swapMB = s.swapUsedMB ?? 0;

    if (freePercent < 8 || swapMB > 500) return 'critical';
    if (freePercent < 15 || swapMB > 0) return 'high';
    if (freePercent < 30) return 'moderate';
    return 'low';
  }

  private windowsPressureLevel(s: MemorySnapshot): PressureLevel {
    // L3 (node_os) uses percentage thresholds — os.freemem() doesn't include standby pages
    if (s.source === 'node_os') {
      const freePercent = 100 - s.usedPercent;
      if (freePercent < 10) return 'critical';
      if (freePercent < 20) return 'high';
      if (freePercent < 35) return 'moderate';
      return 'low';
    }

    // L1/L2 use absolute MB thresholds based on Available MBytes
    const availableMB = s.availableMB ?? s.freeMB;
    const commitPercent = s.commitPercent ?? 0;

    if (availableMB < 512 || commitPercent > 90) return 'critical';
    if (availableMB < 1024 || commitPercent > 80) return 'high';
    if (availableMB < 2048 || commitPercent > 60) return 'moderate';
    return 'low';
  }

  // ========== Lifecycle ==========

  start(intervalMs: number = 15000): void {
    if (this.timer) return;

    const collect = async () => {
      try {
        const snapshot = await this.getMemorySnapshot();
        if (snapshot.error) {
          this.consecutiveFailures++;
        } else {
          this.snapshot = snapshot;
          this.consecutiveFailures = 0;
        }
      } catch {
        this.consecutiveFailures++;
      }
    };

    // Initial collection
    collect().catch(() => {});
    this.timer = setInterval(() => collect().catch(() => {}), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ========== Process Memory (RSS) ==========

  async getProcessMemory(pid: number, projectPath: string): Promise<ProjectMemorySnapshot> {
    const startTime = Date.now();

    try {
      let rssMB: number;

      if (MemoryMonitor.isMacOS()) {
        const output = await execAsync(`ps -p ${pid} -o rss=`, this.collectionTimeoutMs);
        // Output is in KB
        rssMB = parseInt(output.trim(), 10) / 1024;
      } else if (MemoryMonitor.isWindows()) {
        const cmd = `powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64"`;
        const output = await execAsync(cmd, this.collectionTimeoutMs);
        // Output is in bytes
        rssMB = parseInt(output.trim(), 10) / (1024 * 1024);
      } else {
        rssMB = 0;
      }

      return {
        projectPath,
        pid,
        rssMB: Math.round(rssMB * 100) / 100,
        timestamp: Date.now(),
      };
    } catch {
      return {
        projectPath,
        pid,
        rssMB: -1, // -1 indicates collection failure
        timestamp: Date.now(),
      };
    }
  }

  async getAllProcessMemory(
    projects: Array<{ projectPath: string; pid: number }>
  ): Promise<ProjectMemorySnapshot[]> {
    const results = await Promise.all(
      projects.map(p => this.getProcessMemory(p.pid, p.projectPath))
    );
    return results;
  }
}
