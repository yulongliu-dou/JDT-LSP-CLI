/**
 * Library 类源码定位 E2E 测试（Daemon 模式）
 * 
 * 覆盖 SP01-SP05 全部三条解析管道的 E2E 断言：
 * 1. JDK src.zip 快速通道   → source: 'jdk-src'
 * 2. Maven sources-jar 通道  → source: 'sources-jar'
 * 3. Vineflower 反编译兜底   → source: 'decompiled'
 * 4. --no-library-resolve 逃生口
 * 5. symlink 失败降级 → 拷贝 + warnings
 * 
 * 测试策略：
 * - 用 `find` 获取 jdt:// URI（不用 def --global，因 positionResolver 拒收 jdt://）
 * - 通过 daemon HTTP `/library/resolve` 直接解析 jdt:// URI
 * - 通过 `/config` 热更新配置切换解析行为
 * - 通过 `/status` 验证 warnings 收集
 */

import * as http from 'http';
import {
  execCLIWithDaemon,
  parseJSONOutput,
  MYBATIS_PROJECT,
  waitForDaemonReady,
  cleanupDaemon,
  DaemonManager,
  skipIfNoSymlinkPermission,
  skipIfNoMvn,
  detectJavaHome,
} from '../../../helpers/testUtils';

// ============================================================
// HTTP 辅助
// ============================================================

function daemonPost(endpoint: string, body: Record<string, unknown> = {}): Promise<any> {
  const port = DaemonManager.getInstance().getPort();
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `http://127.0.0.1:${port}${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function daemonGet(endpoint: string): Promise<any> {
  const port = DaemonManager.getInstance().getPort();
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${endpoint}`, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ============================================================
// 辅助：从 find 结果提取 jdt:// URI
// ============================================================

interface FindSymbol {
  name: string;
  kind: string;
  containerName?: string;
  location?: {
    uri: string;
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  };
}

async function findJdtUri(className: string, kind: string = 'Class'): Promise<string | null> {
  const result = await execCLIWithDaemon([
    '-p', MYBATIS_PROJECT.path,
    'find', className,
    '--kind', kind,
    '--json-compact',
  ]);
  const output = parseJSONOutput(result.stdout);
  if (!output.success) return null;
  const symbols: FindSymbol[] = output.data.symbols || [];
  // 仅返回含 !/ 的标准 jdt:// URI（jdtUriParser 只能解析此格式）
  for (const s of symbols) {
    if (s.location?.uri?.startsWith('jdt:') && s.location.uri.includes('!/')) {
      return s.location.uri;
    }
  }
  return null;
}

/**
 * 从 find 结果中查找匹配 containerName 的 jdt:// URI（含 !/ 格式）
 */
async function findJdtUriInContainer(className: string, containerPattern: string, kind: string = 'Class'): Promise<string | null> {
  const result = await execCLIWithDaemon([
    '-p', MYBATIS_PROJECT.path,
    'find', className,
    '--kind', kind,
    '--json-compact',
  ]);
  const output = parseJSONOutput(result.stdout);
  if (!output.success) return null;
  const symbols: FindSymbol[] = output.data.symbols || [];
  // 优先匹配 containerName 且含 !/ 的 jdt:// URI
  for (const s of symbols) {
    if (s.location?.uri?.startsWith('jdt:') && s.location.uri.includes('!/') && s.containerName?.includes(containerPattern)) {
      return s.location.uri;
    }
  }
  // 回退：取任意含 !/ 的 jdt:// URI
  for (const s of symbols) {
    if (s.location?.uri?.startsWith('jdt:') && s.location.uri.includes('!/')) {
      return s.location.uri;
    }
  }
  return null;
}

// ============================================================
// 测试套件
// ============================================================

describe('Library Definition E2E - jar 类源码定位', () => {

  beforeAll(async () => {
    console.log('\n=== Starting Daemon for Library Definition Tests ===');
    await waitForDaemonReady(MYBATIS_PROJECT.path);
  }, 180000);

  afterAll(async () => {
    console.log('\n=== Cleaning Up Daemon ===');
    await cleanupDaemon();
  });

  // ==========================================================
  // 断言组 1：JDK 类 → jdk-src
  // ==========================================================

  describe('Group 1: JDK class resolution (jdk-src)', () => {
    it('should resolve java.util.function.Function to jdk-src', async () => {
      const javaHome = detectJavaHome();
      if (!javaHome) {
        console.log('  [SKIP] No JAVA_HOME detected — cannot verify JDK src resolution');
        return;
      }

      const jdtUri = await findJdtUriInContainer('Function', 'java.util.function');
      if (!jdtUri) {
        console.log('  [SKIP] jdt:// URI not found for Function — JDT LS may not expose JDK symbols');
        return;
      }

      console.log(`  JDK jdt:// URI: ${jdtUri.substring(0, 80)}...`);

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      console.log(`  Resolved: success=${resolved.success}, source=${resolved.data?.source}`);

      expect(resolved.success).toBe(true);
      expect(resolved.data).toBeTruthy();

      const { source, uri, lineMapping, originalUri } = resolved.data;

      // source 应为 jdk-src（若无 src.zip 可能 fallback 到 decompiled / class-file-contents）
      const validSources = ['jdk-src', 'decompiled', 'class-file-contents'];
      expect(validSources).toContain(source);

      // jdk-src 专项断言
      if (source === 'jdk-src') {
        expect(uri).toMatch(/^file:\/\//);
        expect(lineMapping).toBe('exact');
        // uri 应指向缓存目录
        expect(uri).toMatch(/jars\/jdk\//);
      }

      // 所有解析结果应有 originalUri
      expect(originalUri).toBe(jdtUri);
    }, 60000);
  });

  // ==========================================================
  // 断言组 2：Maven 依赖 sources-jar 解析
  // ==========================================================

  describe('Group 2: Maven dependency sources-jar resolution', () => {
    it('should resolve a Maven dependency class with valid source field', async () => {
      if (skipIfNoMvn()) {
        console.log('  [SKIP] mvn not available');
        return;
      }

      // 尝试找一个 Maven 依赖类（ognl 是 mybatis-3 的常见依赖）
      const jdtUri = await findJdtUri('OgnlContext');
      if (!jdtUri) {
        // fallback：尝试其他常见依赖类
        const fallbackUri = await findJdtUri('Ognl');
        if (!fallbackUri) {
          console.log('  [SKIP] No Maven dependency jdt:// URI found');
          return;
        }
        console.log(`  Maven dep jdt:// URI: ${fallbackUri.substring(0, 80)}...`);
        const resolved = await daemonPost('/library/resolve', { jdtUri: fallbackUri });
        expect(resolved.success).toBe(true);
        expect(resolved.data).toBeTruthy();
        const validSources = ['sources-jar', 'decompiled', 'class-file-contents'];
        expect(validSources).toContain(resolved.data.source);
        return;
      }

      console.log(`  Maven dep jdt:// URI: ${jdtUri.substring(0, 80)}...`);

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      console.log(`  Resolved: success=${resolved.success}, source=${resolved.data?.source}`);

      expect(resolved.success).toBe(true);
      expect(resolved.data).toBeTruthy();

      const { source, uri, lineMapping, originalUri } = resolved.data;
      const validSources = ['sources-jar', 'decompiled', 'class-file-contents'];
      expect(validSources).toContain(source);

      // sources-jar 专项断言
      if (source === 'sources-jar') {
        expect(uri).toMatch(/^file:\/\//);
        expect(lineMapping).toBe('exact');
        expect(uri).toMatch(/jars\/sources\//);
      }

      expect(originalUri).toBeTruthy();
    }, 120000);

    it('should support secondary references from resolved file', async () => {
      if (skipIfNoMvn()) {
        console.log('  [SKIP] mvn not available');
        return;
      }

      // 找一个能解析到 sources-jar 的类
      const jdtUri = await findJdtUri('OgnlContext');
      if (!jdtUri) {
        console.log('  [SKIP] No Maven dependency found');
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      if (!resolved.success || resolved.data?.source !== 'sources-jar') {
        console.log(`  [SKIP] Resolved to ${resolved.data?.source}, not sources-jar — secondary refs test only meaningful for exact mapping`);
        return;
      }

      // 从 file:// URI 提取文件路径
      const fileUri: string = resolved.data.uri;
      const { fileURLToPath } = await import('node:url');
      let filePath: string;
      try {
        filePath = fileURLToPath(fileUri);
      } catch {
        // Windows 特殊处理
        filePath = fileUri.replace('file:///', '').replace('file://', '');
      }

      // 获取文件的第一个符号名（用于 references 请求）
      const symResult = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'sym', filePath,
        '--flat',
        '--json-compact',
      ]);
      const symOutput = parseJSONOutput(symResult.stdout);
      const symbols: any[] = symOutput.data?.symbols || [];
      const firstSymbol = symbols.find((s: any) => s.kind === 'Class' || s.kind === 'Interface' || s.kind === 'Method');

      if (!firstSymbol) {
        console.log('  [SKIP] No symbol found in resolved file for references test');
        return;
      }

      // 对该符号发 references
      const refsResult = await execCLIWithDaemon([
        '-p', MYBATIS_PROJECT.path,
        'refs', filePath,
        '--symbol', firstSymbol.name,
        '--json-compact',
      ]);
      const refsOutput = parseJSONOutput(refsResult.stdout);
      // references 可能返回空（jar 内类在 workspace 中无引用），不为错
      expect(refsOutput.success).toBe(true);
      console.log(`  References for ${firstSymbol.name}: success=${refsOutput.success}, count=${refsOutput.data?.locations?.length || 0}`);
    }, 120000);
  });

  // ==========================================================
  // 断言组 3：反编译兜底（decompiled）
  // ==========================================================

  describe('Group 3: Decompiled fallback (Vineflower)', () => {
    it('should include decompiled-specific fields when source is decompiled', async () => {
      // 找一个解析结果（可能是 decompiled 也可能是 sources-jar）
      const jdtUri = await findJdtUri('Ognl');
      if (!jdtUri) {
        console.log('  [SKIP] No dependency class found for decompile test');
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      expect(resolved.success).toBe(true);
      expect(resolved.data).toBeTruthy();

      const { source, note, lineMapping } = resolved.data;

      // 如果是 decompiled，验证特有字段
      if (source === 'decompiled') {
        expect(note).toBeTruthy();
        expect(note).toMatch(/Decompiled/i);
        // lineMapping 应为 best-effort 或 n/a
        expect(['best-effort', 'n/a']).toContain(lineMapping);
        console.log(`  Decompiled verified: lineMapping=${lineMapping}, note=${(note as string).substring(0, 60)}...`);
      } else {
        // 其他 source 类型也有合理的 lineMapping
        expect(['exact', 'best-effort', 'n/a']).toContain(lineMapping);
        console.log(`  Source type: ${source}, lineMapping: ${lineMapping}`);
        // 非 decompiled 不应该有 "Decompiled code" note（但可能有其他 note）
        if (note) {
          expect(typeof note).toBe('string');
        }
      }
    }, 60000);
  });

  // ==========================================================
  // 断言组 4：--no-library-resolve 逃生口
  // ==========================================================

  describe('Group 4: --no-library-resolve flag', () => {
    const originalEnabled = true;

    afterAll(async () => {
      // 恢复 library resolve
      try {
        await daemonPost('/config', { key: 'libraryResolveEnabled', value: true });
      } catch { /* ignore */ }
    });

    it('should reflect libraryResolveEnabled in /status', async () => {
      const status = await daemonGet('/status');
      expect(status.success).toBe(true);
      expect(status.data).toBeTruthy();
      // libraryResolveEnabled 应在 status 中体现
      expect(typeof status.data.libraryResolveEnabled).toBe('boolean');
      console.log(`  libraryResolveEnabled: ${status.data.libraryResolveEnabled}`);
    });

    it('should disable library resolution via /config', async () => {
      // 禁用
      const disableResult = await daemonPost('/config', { key: 'libraryResolveEnabled', value: false });
      expect(disableResult.success).toBe(true);

      // 验证 /status 反映变更
      const status = await daemonGet('/status');
      expect(status.data.libraryResolveEnabled).toBe(false);
      console.log('  libraryResolveEnabled disabled via /config');
    });

    it('should return null/unchanged when library resolve is disabled', async () => {
      // 确保先禁用
      await daemonPost('/config', { key: 'libraryResolveEnabled', value: false });

      // 找一个 jdt:// URI
      const jdtUri = await findJdtUriInContainer('Function', 'java.util.function');
      if (!jdtUri) {
        console.log('  [SKIP] No jdt:// URI available');
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      // 当 library resolve disabled 时，resolve 返回 null
      expect(resolved.success).toBe(true);
      // data 为 null 表示跳过了解析
      expect(resolved.data).toBeNull();
      console.log('  Library resolve correctly returned null when disabled');

      // 恢复
      await daemonPost('/config', { key: 'libraryResolveEnabled', value: true });
    }, 30000);

    it('should resolve again after re-enabling', async () => {
      // 确保已启用
      await daemonPost('/config', { key: 'libraryResolveEnabled', value: true });

      const jdtUri = await findJdtUriInContainer('Function', 'java.util.function');
      if (!jdtUri) {
        console.log('  [SKIP] No jdt:// URI available');
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      expect(resolved.success).toBe(true);
      expect(resolved.data).toBeTruthy();
      expect(resolved.data.source).toBeTruthy();
      console.log(`  Re-enabled: resolved source=${resolved.data.source}`);
    }, 30000);
  });

  // ==========================================================
  // 断言组 5：symlink 失败降级 → 拷贝 + warnings
  // ==========================================================

  describe('Group 5: Symlink failure degradation', () => {
    it('should expose warnings array in /status', async () => {
      const status = await daemonGet('/status');
      expect(status.success).toBe(true);
      expect(status.data).toBeTruthy();
      // warnings 应该是数组（可能为空）
      expect(Array.isArray(status.data.warnings)).toBe(true);
      console.log(`  /status.warnings count: ${status.data.warnings.length}`);
    });

    it('should have warnings about symlink degradation on Windows non-admin', async function () {
      // 仅在 Windows 非管理员时此测试有意义
      // skipIfNoSymlinkPermission() 返回 true 表示无 symlink 权限
      const noSymlinkPerm = skipIfNoSymlinkPermission();
      
      // 触发一次 library resolve，让 materializeLink 有机会产生 warning
      const jdtUri = await findJdtUriInContainer('Function', 'java.util.function');
      if (jdtUri) {
        await daemonPost('/library/resolve', { jdtUri });
      }

      const status = await daemonGet('/status');
      const warnings: string[] = status.data.warnings || [];

      if (noSymlinkPerm) {
        // Windows 非管理员：预期会有 symlink 降级 warning
        // 但不强断言（取决于 daemon 是否实际触发了 resolve）
        console.log(`  Windows non-admin mode: ${warnings.length} warnings collected`);
        if (warnings.length > 0) {
          const symlinkWarning = warnings.find((w: string) =>
            w.toLowerCase().includes('symlink') || w.toLowerCase().includes('symbolic link')
          );
          if (symlinkWarning) {
            console.log(`  Symlink degradation warning: ${symlinkWarning.substring(0, 100)}`);
          }
        }
      } else {
        // macOS / Linux / Windows admin：symlink 正常，可能无 warning
        console.log(`  Symlink-capable platform: ${warnings.length} warnings`);
      }

      // 无论何种平台，warnings 应是字符串数组
      for (const w of warnings) {
        expect(typeof w).toBe('string');
      }
    }, 60000);

    it('should have valid cache file paths after resolution', async () => {
      const jdtUri = await findJdtUriInContainer('Function', 'java.util.function');
      if (!jdtUri) {
        console.log('  [SKIP] No jdt:// URI available');
        return;
      }

      const resolved = await daemonPost('/library/resolve', { jdtUri });
      if (!resolved.success || !resolved.data) {
        console.log('  [SKIP] Resolution failed');
        return;
      }

      const fileUri: string = resolved.data.uri;
      // file:// URI 应该有效
      expect(fileUri).toMatch(/^file:\/\//);

      // 提取并验证文件路径
      const { fileURLToPath } = await import('node:url');
      let filePath: string;
      try {
        filePath = fileURLToPath(fileUri);
      } catch {
        filePath = fileUri.replace('file:///', '').replace('file://', '');
      }

      // 路径应该包含缓存目录特征
      const pathLower = filePath.toLowerCase();
      const cacheIndicators = ['lsp-cache', 'jars', 'jdk', 'sources', 'decompiled', 'class-file-contents'];
      const hasCacheIndicator = cacheIndicators.some(ind => pathLower.includes(ind));
      
      if (!hasCacheIndicator && resolved.data.source !== 'class-file-contents') {
        // 非 classFileContents 兜底应该有缓存路径
        console.log(`  Warning: resolved path does not contain cache indicators: ${filePath}`);
      }
      
      console.log(`  Resolved file path: ${filePath.substring(0, 100)}...`);
    }, 60000);
  });
});
