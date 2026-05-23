import { Command } from 'commander';
import { getJdtlsManager } from '../../jdt/embedded/jdtlsManager';

// ── Help ──────────────────────────────────────────────────────────────────────

const JDT_STATUS_HELP = `
Usage: jls jdt status

显示内嵌 JDT LS 的状态（来源、版本、路径、就绪状态）。
`;

const JDT_UPDATE_HELP = `
Usage: jls jdt update

从内置包重新解压安装 JDT LS。
`;

const JDT_REMOVE_HELP = `
Usage: jls jdt remove

删除内嵌 JDT LS，后续回退使用 VS Code 扩展或手动下载。
`;

// ── Command ───────────────────────────────────────────────────────────────────

export function registerJdt(program: Command): void {
  const jdtCmd = program
    .command('jdt')
    .description('管理内嵌 JDT LS。');

  jdtCmd
    .command('status')
    .description('显示 JDT LS 状态。')
    .configureHelp({ formatHelp: () => JDT_STATUS_HELP })
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
    .description('重新解压安装 JDT LS。')
    .configureHelp({ formatHelp: () => JDT_UPDATE_HELP })
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
    .description('删除内嵌 JDT LS。')
    .configureHelp({ formatHelp: () => JDT_REMOVE_HELP })
    .action(async () => {
      const manager = getJdtlsManager();
      await manager.remove();
      console.log('内嵌 JDT LS 已删除');
      console.log('下次运行 jls 时将使用 VS Code 扩展或提示手动下载');
    });
}
