import { Command } from 'commander';
import { getJreManager } from '../../jdt/embedded/jreManager';

export function registerJre(program: Command): void {
  const jreCmd = program
    .command('jre')
    .description('Manage the embedded JRE environment');

  jreCmd
    .command('status')
    .description('Show JRE status')
    .action(async () => {
      const manager = getJreManager();
      const status = await manager.getStatus();

      console.log('JRE 状态:');
      console.log(`  来源:   ${status.source}`);
      console.log(`  版本:   ${status.version}`);
      console.log(`  路径:   ${status.path}`);
      console.log(`  大小:   ${status.size}`);
      console.log(`  状态:   ${status.ready ? '✓ 就绪' : '✗ 未安装'}`);

      if (!status.ready) {
        console.log('');
        console.log('运行 `jls jre download` 下载优化版 Adoptium JRE 21');
      }
    });

  jreCmd
    .command('download')
    .description('Download or re-download the embedded Adoptium JRE 21')
    .action(async () => {
      const manager = getJreManager();

      try {
        await manager.remove();
        console.log('已清理旧版本 JRE');
      } catch {}

      const jre = await manager.ensure();
      console.log(`JRE ${jre.version} 就绪`);
    });

  jreCmd
    .command('remove')
    .description('Remove embedded JRE, fall back to system Java')
    .action(async () => {
      const manager = getJreManager();
      await manager.remove();
      console.log('内嵌 JRE 已删除');
      console.log('下次运行 jls 时将使用系统 Java（如可用）');
    });
}
