/**
 * callHierarchy --lifecycle E2E 测试
 *
 * 使用 field-lifecycle-demo Java 项目验证调用链节点的字段级读写追踪功能。
 */

import { execCLI, parseJSONOutput } from '../../../helpers/testUtils';

const PROJECT_PATH = process.env.FIELD_LIFECYCLE_PROJECT_PATH || 'E:/field-lifecycle-demo';
const ORDER_SERVICE = 'src/main/java/com/example/lifecycle/service/OrderService.java';
const ORDER_CONVERTER = 'src/main/java/com/example/lifecycle/converter/OrderConverter.java';

async function jls(args: string[]): Promise<any> {
  const result = await execCLI(args, { cwd: PROJECT_PATH });
  return parseJSONOutput(result.stdout);
}

describe('ch --lifecycle on OrderService.queryOrder', () => {
  test('should return call hierarchy with fieldFlow on callee nodes', async () => {
    const result = await jls([
      'ch', ORDER_SERVICE,
      '--method', 'queryOrder',
      '--index', '0',
      '-d', '1',
      '--lifecycle',
    ]);

    expect(result.success).toBe(true);
    expect(result.data.calls).toBeDefined();
    expect(result.data.calls.length).toBeGreaterThan(0);

    const calleesWithFieldFlow = result.data.calls.filter(
      (c: any) => c.fieldFlow !== undefined
    );
    expect(calleesWithFieldFlow.length).toBeGreaterThan(0);

    for (const call of calleesWithFieldFlow) {
      expect(Array.isArray(call.fieldFlow.reads)).toBe(true);
      expect(Array.isArray(call.fieldFlow.writes)).toBe(true);
    }
  }, 180000);

  test('should detect status field reads/writes in converter methods', async () => {
    const result = await jls([
      'ch', ORDER_SERVICE,
      '--method', 'queryOrder',
      '--index', '0',
      '-d', '1',
      '--lifecycle',
    ]);

    const entityToDtoCall = result.data.calls.find(
      (c: any) => c.callee === 'entityToDto'
    );

    if (entityToDtoCall) {
      const { reads, writes } = entityToDtoCall.fieldFlow;
      expect(reads.some((r: string) => r.includes('status'))).toBe(true);
      expect(writes.some((w: string) => w.includes('status'))).toBe(true);
    }
  }, 180000);

  test('should detect field reads/writes in dtoToVo', async () => {
    const result = await jls([
      'ch', ORDER_SERVICE,
      '--method', 'queryOrder',
      '--index', '0',
      '-d', '1',
      '--lifecycle',
    ]);

    const dtoToVoCall = result.data.calls.find(
      (c: any) => c.callee === 'dtoToVo'
    );

    if (dtoToVoCall) {
      const { reads, writes } = dtoToVoCall.fieldFlow;
      expect(reads.some((r: string) => r.includes('status'))).toBe(true);
      expect(writes.some((w: string) => w.includes('status'))).toBe(true);
    }
  }, 180000);
});

describe('ch --lifecycle on OrderConverter.entityToDto', () => {
  test('should show entityToDto as callee reads from entity and writes to dto', async () => {
    // 通过 queryOrder 间接获取 entityToDto 作为 callee，此时才能看到 fieldFlow
    const result = await jls([
      'ch', ORDER_SERVICE,
      '--method', 'queryOrder',
      '--index', '0',
      '-d', '1',
      '--lifecycle',
    ]);

    expect(result.success).toBe(true);

    const entityToDtoCall = result.data.calls.find(
      (c: any) => c.callee && c.callee.includes('entityToDto')
    );

    expect(entityToDtoCall).toBeDefined();
    expect(entityToDtoCall.fieldFlow).toBeDefined();

    const { reads, writes } = entityToDtoCall.fieldFlow;
    const hasEntityRead = reads.some((r: string) => r.startsWith('OrderEntity.'));
    const hasDtoWrite = writes.some((w: string) => w.startsWith('OrderDTO.'));

    expect(hasEntityRead).toBe(true);
    expect(hasDtoWrite).toBe(true);
  }, 180000);
});

describe('ch backward compatibility', () => {
  test('without --lifecycle should NOT include fieldFlow in callee nodes', async () => {
    const result = await jls([
      'ch', ORDER_SERVICE,
      '--method', 'queryOrder',
      '--index', '0',
      '-d', '1',
    ]);

    expect(result.success).toBe(true);
    expect(result.data.calls).toBeDefined();

    for (const call of result.data.calls) {
      expect(call.fieldFlow).toBeUndefined();
      expect(call.detail).toBeUndefined();
    }
  }, 180000);
});
