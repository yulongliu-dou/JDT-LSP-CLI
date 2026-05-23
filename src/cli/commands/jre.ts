import { Command, Help } from 'commander';
// 恢复 commander 默认 help 输出（不被 root 的 configureHelp 覆盖）
const defaultFormatHelp = (cmd: Command, helper: Help) => new Help().formatHelp(cmd, helper);
import { getJreManager } from '../../jdt/embedded/jreManager';

import { JRE_STATUS_HELP, JRE_DOWNLOAD_HELP, JRE_REMOVE_HELP } from './help/jreHelp';

// ── Command ───────────────────────────────────────────────────────────────────

export function registerJre(program: Command): void {
  const jreCmd = program
    .command('jre')
    .description('管理内嵌 JRE 环境。')
    .configureHelp({ formatHelp: defaultFormatHelp });

  jreCmd
    .command('status')
    .description('显示 JRE 状态。')
    .configureHelp({ formatHelp: () => JRE_STATUS_HELP })
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
    .description('下载或重新下载内嵌 Adoptium JRE 21。')
    .configureHelp({ formatHelp: () => JRE_DOWNLOAD_HELP })
    .option('--choose', '交互选择下载源')
    .action(async (options) => {
      const manager = getJreManager();

      try {
        await manager.remove();
        console.log('已清理旧版本 JRE');
      } catch {}

      const jre = await manager.ensure(options.choose);
      console.log(`JRE ${jre.version} 就绪`);
    });

  jreCmd
    .command('remove')
    .description('删除内嵌 JRE。')
    .configureHelp({ formatHelp: () => JRE_REMOVE_HELP })
    .action(async () => {
      const manager = getJreManager();
      await manager.remove();
      console.log('内嵌 JRE 已删除');
      console.log('下次运行 jls 时将使用系统 Java（如可用）');
    });
}
