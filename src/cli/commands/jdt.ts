import { Command } from 'commander';
import { getJdtlsManager } from '../../jdt/embedded/jdtlsManager';

export function registerJdt(program: Command): void {
  const jdtCmd = program
    .command('jdt')
    .description('Manage the embedded JDT LS');

  jdtCmd
    .command('status')
    .description('Show JDT LS status')
    .action(async () => {
      const manager = getJdtlsManager();
      const status = await manager.getStatus();

      console.log('JDT LS 状态:');
      console.log(`  来源:   ${status.source}`);
      console.log(`  版本:   ${status.version}`);
      console.log(`  路径:   ${status.path}`);
      console.log(`  大小:   ${status.size}`);
      console.log(`  状态:   ${status.ready ? '✓ 就绪' : '✗ 未安装'}`);

      if (!status.ready) {
        console.log('');
        console.log('运行 `jls jdt update` 重新安装 JDT LS');
      }
    });

  jdtCmd
    .command('update')
    .description('Re-extract JDT LS from bundled package')
    .action(async () => {
      const manager = getJdtlsManager();
      try {
        const info = await manager.update();
        console.log(`JDT LS ${info.version} 就绪 (${info.size})`);
      } catch (err: any) {
        console.error(`安装失败: ${err.message}`);
        process.exit(1);
      }
    });

  jdtCmd
    .command('remove')
    .description('Remove embedded JDT LS, fall back to other sources')
    .action(async () => {
      const manager = getJdtlsManager();
      await manager.remove();
      console.log('内嵌 JDT LS 已删除');
      console.log('下次运行 jls 时将使用 VS Code 扩展或提示手动下载');
    });
}
