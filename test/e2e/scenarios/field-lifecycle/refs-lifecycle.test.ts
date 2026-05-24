/**
 * refs --lifecycle E2E 测试
 *
 * 使用 field-lifecycle-demo Java 项目验证字段全生命周期追踪功能。
 */

import { execCLI, parseJSONOutput } from '../../../helpers/testUtils';

const PROJECT_PATH = process.env.FIELD_LIFECYCLE_PROJECT_PATH || 'E:/field-lifecycle-demo';
const ORDER_ENTITY = 'src/main/java/com/example/lifecycle/entity/OrderEntity.java';

async function jls(args: string[]): Promise<any> {
  const result = await execCLI(args, { cwd: PROJECT_PATH });
  return parseJSONOutput(result.stdout);
}

describe('refs --lifecycle on OrderEntity.status', () => {
  test('should return lifecycle structure (summary + references + hints)', async () => {
    const result = await jls(['refs', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field', '--lifecycle']);

    expect(result.success).toBe(true);
    expect(result.data.summary).toBeDefined();
    expect(result.data.references).toBeDefined();
    expect(result.data.hints).toBeDefined();

    expect(result.data.summary.field.name).toBe('status');
    expect(result.data.summary.field.containingClass).toBe('OrderEntity');

    for (const ref of result.data.references) {
      expect(ref.sourceLine).toBeDefined();
      expect(ref.accessType).toBeDefined();
      expect(['read', 'write', 'readWrite', 'unknown']).toContain(ref.accessType);
      expect(ref.via).toBeDefined();
      expect(['direct', 'getter', 'setter', 'reflection', 'unknown']).toContain(ref.via);
      expect(ref.context).toBeDefined();
      expect(ref.context.enclosingMethod).toBeDefined();
      expect(ref.context.enclosingClass).toBeDefined();
    }
  }, 180000);

  test('should detect DB annotation mapping', async () => {
    const result = await jls(['refs', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field', '--lifecycle']);

    const dbAnnotations = result.data.summary.annotations.db;
    expect(dbAnnotations).toBeDefined();
    const colAnn = dbAnnotations.find((a: any) => a.name === '@Column');
    expect(colAnn).toBeDefined();
    expect(colAnn.attributes.name).toBe('order_status');
  }, 180000);

  test('should detect Lombok @Data annotation', async () => {
    const result = await jls(['refs', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field', '--lifecycle']);

    const lombokAnnotations = result.data.summary.annotations.lombok;
    expect(lombokAnnotations).toBeDefined();
    const dataAnn = lombokAnnotations.find((a: any) => a.name === '@Data');
    expect(dataAnn).toBeDefined();
  }, 180000);

  test('should contain hints.unreachableViaJdtLs', async () => {
    const result = await jls(['refs', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field', '--lifecycle']);

    expect(result.data.hints.unreachableViaJdtLs).toBeDefined();
    expect(result.data.hints.unreachableViaJdtLs.length).toBeGreaterThan(0);
  }, 180000);

  test('should discover same-name field propagation targets', async () => {
    const result = await jls(['refs', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field', '--lifecycle']);

    const targets = result.data.summary.propagationTargets;
    expect(targets.length).toBeGreaterThanOrEqual(1);
    const classNames = targets.map((t: any) => t.class);
    expect(classNames.some((c: string) => c.includes('OrderDTO'))).toBe(true);
    expect(classNames.some((c: string) => c.includes('OrderVO'))).toBe(true);
  }, 180000);
});

describe('definition default enhancement', () => {
  test('field def should include annotation info', async () => {
    const result = await jls(['def', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field']);

    expect(result.success).toBe(true);
    expect(result.data.annotations).toBeDefined();
    const dbAnnotations = result.data.annotations.db;
    expect(dbAnnotations).toBeDefined();
    const colAnn = dbAnnotations.find((a: any) => a.name === '@Column');
    expect(colAnn).toBeDefined();
    expect(colAnn.attributes.name).toBe('order_status');
  }, 180000);
});

describe('refs --lifecycle backward compatibility', () => {
  test('without --lifecycle should keep original output format', async () => {
    const result = await jls(['refs', ORDER_ENTITY, '--symbol', 'status', '--kind', 'Field']);

    expect(result.success).toBe(true);
    expect(result.data.references).toBeDefined();
    expect(result.data.count).toBeDefined();
    expect(result.data.summary).toBeUndefined();
    expect(result.data.hints).toBeUndefined();
  }, 180000);
});
