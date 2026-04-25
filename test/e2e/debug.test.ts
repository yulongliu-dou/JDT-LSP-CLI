/**
 * 调试 E2E 测试
 */

import { execCLI, parseJSONOutput, MYBATIS_PROJECT } from '../helpers/testUtils';

describe('E2E Debug Test', () => {
  it('should execute find command with debug output', async () => {
    console.log('\n=== Testing find command ===');
    console.log('Project path:', MYBATIS_PROJECT.path);
    console.log('Project exists:', MYBATIS_PROJECT.exists());
    
    const result = await execCLI([
      '-p', MYBATIS_PROJECT.path,
      'find', 'SqlSession',
      '--kind', 'Class',
      '--json-compact'
    ], { debug: true });
    
    console.log('\n=== Result ===');
    console.log('Exit code:', result.exitCode);
    console.log('Stdout length:', result.stdout.length);
    console.log('Stderr:', result.stderr);
    console.log('\nStdout preview (first 200 chars):');
    console.log(result.stdout.substring(0, 200));
    
    const output = parseJSONOutput(result.stdout);
    console.log('\nParsed output:');
    console.log('Success:', output.success);
    console.log('Data count:', output.data?.count || 0);
    
    expect(output.success).toBe(true);
  }, 60000);
});
