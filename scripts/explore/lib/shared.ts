/**
 * explore 共享库 — 配置、工具函数、客户端工厂
 */

import * as path from 'path';
import * as fs from 'fs';
import { JdtLsClient } from '../../../src/jdt/client';

// ============================================================
// 配置
// ============================================================

const DEFAULT_PROJECT = 'E:\\mybatis-3-master';

/** 主测试文件 */
export const MAIN_FILE = 'src/main/java/org/apache/ibatis/session/defaults/DefaultSqlSession.java';
/** 接口测试文件（用于 implementations） */
export const INTERFACE_FILE = 'src/main/java/org/apache/ibatis/session/SqlSession.java';

/** 方法声明位置（selectOne 方法名，DefaultSqlSession.java L67） */
export const METHOD_POS = { line: 67, col: 20 };
/** 方法体内部位置（用于 inlayHint/completion/signatureHelp） */
export const BODY_POS = { line: 60, col: 8 };
/** 接口方法位置（SqlSession.java） */
export const IFACE_METHOD_POS = { line: 45, col: 12 };

// ============================================================
// 路径工具
// ============================================================

export interface ExploreConfig {
  projectPath: string;
  outputDir: string;
  mainFileFull: string;
  interfaceFileFull: string;
}

export function resolveProject(cliArg?: string): ExploreConfig {
  const projectPath = cliArg || process.env.MYBATIS_PROJECT_PATH || DEFAULT_PROJECT;
  const outputDir = path.join(__dirname, '..', '..', '..', 'test-output', 'explore');
  return {
    projectPath,
    outputDir,
    mainFileFull: path.join(projectPath, MAIN_FILE),
    interfaceFileFull: path.join(projectPath, INTERFACE_FILE),
  };
}

// ============================================================
// 文件工具
// ============================================================

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function saveResult(
  outputDir: string,
  name: string,
  lspMethod: string,
  rawResult: any,
  error?: string,
): void {
  const output: any = {
    exploredAt: new Date().toISOString(),
    lspMethod,
    success: !error,
  };

  if (error) {
    output.error = error;
  } else {
    output.rawResponse = rawResult;
  }

  if (!error) {
    const rt = typeof rawResult;
    if (rt === 'object' && rawResult !== null) {
      output.typeSummary = {
        type: Array.isArray(rawResult) ? 'array' : 'object',
        isNull: false,
        length: Array.isArray(rawResult) ? rawResult.length : Object.keys(rawResult).length,
        keys: Array.isArray(rawResult) ? undefined : Object.keys(rawResult).slice(0, 30),
      };
    } else {
      output.typeSummary = { type: rt, isNull: rawResult === null };
    }
  }

  const filePath = path.join(outputDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
}

// ============================================================
// 客户端工厂
// ============================================================

export async function createClient(projectPath: string): Promise<JdtLsClient> {
  const client = new JdtLsClient(
    {
      projectPath,
      verbose: true,
      timeout: 300000,
    },
    { xms: '512m', xmx: '2g' },
  );
  await client.start();
  return client;
}

// ============================================================
// 独立运行包装器
// ============================================================

export async function runStandalone(
  name: string,
  lspMethod: string,
  call: (client: JdtLsClient) => Promise<any>,
  cliArg?: string,
): Promise<void> {
  const config = resolveProject(cliArg);
  ensureDir(config.outputDir);

  // 验证项目路径
  if (!fs.existsSync(config.projectPath)) {
    console.error(`错误：项目路径不存在: ${config.projectPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(config.mainFileFull)) {
    console.error(`错误：测试文件不存在: ${config.mainFileFull}`);
    process.exit(1);
  }

  console.log(`[explore-${name}] 启动 JDT LS ...`);
  const client = await createClient(config.projectPath);
  try {
    console.log(`[explore-${name}] 调用 ${lspMethod} ...`);
    const result = await call(client);
    saveResult(config.outputDir, name, lspMethod, result);
    console.log(`[explore-${name}] 完成 -> ${name}.json`);
  } catch (e: any) {
    saveResult(config.outputDir, name, lspMethod, null, `Error: ${e.message || String(e)}`);
    console.error(`[explore-${name}] 错误: ${e.message || String(e)}`);
  } finally {
    await client.stop();
  }
}
