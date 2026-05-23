import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EmbeddedJdtlsManager } from '../../../../src/jdt/embedded/jdtlsManager';

describe('EmbeddedJdtlsManager', () => {
  let manager: EmbeddedJdtlsManager;
  let testStorageDir: string;

  beforeEach(() => {
    testStorageDir = path.join(os.tmpdir(), `jdtls-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Override the storage dir by setting env var
    process.env.JDTLS_TEST_STORAGE = testStorageDir;
    manager = new EmbeddedJdtlsManager();
  });

  afterEach(() => {
    try { fs.rmSync(testStorageDir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.JDTLS_TEST_STORAGE;
  });

  describe('getCachedJdtls', () => {
    it('returns null when storage dir is empty', () => {
      fs.mkdirSync(testStorageDir, { recursive: true });
      // HACK: directly set storageDir via reflection for testing
      (manager as any).storageDir = testStorageDir;
      expect(manager.getCachedJdtls()).toBeNull();
    });

    it('returns null when storage dir does not exist', () => {
      (manager as any).storageDir = testStorageDir;
      expect(manager.getCachedJdtls()).toBeNull();
    });

    it('returns valid info when cached version has plugins/launcher jar', () => {
      const versionDir = path.join(testStorageDir, '1.58.0');
      const pluginsDir = path.join(versionDir, 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(pluginsDir, 'org.eclipse.equinox.launcher_1.6.0.v20240101.jar'), '');

      (manager as any).storageDir = testStorageDir;
      const info = manager.getCachedJdtls();
      expect(info).not.toBeNull();
      expect(info!.version).toBe('1.58.0');
      expect(info!.path).toBe(versionDir);
      expect(info!.ready).toBe(true);
    });

    it('returns null when version dir has no plugins directory', () => {
      const versionDir = path.join(testStorageDir, '1.58.0');
      fs.mkdirSync(versionDir, { recursive: true });

      (manager as any).storageDir = testStorageDir;
      expect(manager.getCachedJdtls()).toBeNull();
    });

    it('returns null when plugins dir has no launcher jar', () => {
      const versionDir = path.join(testStorageDir, '1.58.0');
      const pluginsDir = path.join(versionDir, 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });

      (manager as any).storageDir = testStorageDir;
      expect(manager.getCachedJdtls()).toBeNull();
    });

    it('picks the highest version when multiple are cached', () => {
      // Create 1.9.0 (valid)
      const v190 = path.join(testStorageDir, '1.9.0');
      const plugins190 = path.join(v190, 'plugins');
      fs.mkdirSync(plugins190, { recursive: true });
      fs.writeFileSync(path.join(plugins190, 'org.eclipse.equinox.launcher_1.5.0.jar'), '');

      // Create 1.58.0 (valid)
      const v1580 = path.join(testStorageDir, '1.58.0');
      const plugins1580 = path.join(v1580, 'plugins');
      fs.mkdirSync(plugins1580, { recursive: true });
      fs.writeFileSync(path.join(plugins1580, 'org.eclipse.equinox.launcher_1.6.0.jar'), '');

      // Create 1.10.0 (valid)
      const v1100 = path.join(testStorageDir, '1.10.0');
      const plugins1100 = path.join(v1100, 'plugins');
      fs.mkdirSync(plugins1100, { recursive: true });
      fs.writeFileSync(path.join(plugins1100, 'org.eclipse.equinox.launcher_1.7.0.jar'), '');

      (manager as any).storageDir = testStorageDir;
      const info = manager.getCachedJdtls();
      // 1.58.0 > 1.10.0 > 1.9.0
      expect(info).not.toBeNull();
      expect(info!.version).toBe('1.58.0');
    });
  });

  describe('getStatus', () => {
    it('returns none status when nothing is cached', async () => {
      (manager as any).storageDir = testStorageDir;
      fs.mkdirSync(testStorageDir, { recursive: true });
      const status = await manager.getStatus();
      expect(status.ready).toBe(false);
      expect(status.source).toBe('none');
    });

    it('returns ready status when valid version is cached', async () => {
      const versionDir = path.join(testStorageDir, '1.58.0');
      const pluginsDir = path.join(versionDir, 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(pluginsDir, 'org.eclipse.equinox.launcher_1.6.0.jar'), '');

      (manager as any).storageDir = testStorageDir;
      const status = await manager.getStatus();
      expect(status.ready).toBe(true);
      expect(status.version).toBe('1.58.0');
    });
  });

  describe('remove', () => {
    it('clears all cached versions', async () => {
      const versionDir = path.join(testStorageDir, '1.58.0');
      fs.mkdirSync(path.join(versionDir, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(versionDir, 'plugins', 'test.jar'), '');

      (manager as any).storageDir = testStorageDir;
      expect(fs.existsSync(versionDir)).toBe(true);

      await manager.remove();
      expect(fs.existsSync(versionDir)).toBe(false);
    });

    it('does nothing when storage dir does not exist', async () => {
      (manager as any).storageDir = testStorageDir;
      await expect(manager.remove()).resolves.toBeUndefined();
    });
  });
});
