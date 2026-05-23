/**
 * Config 命令处理
 * 
 * 负责：
 * - 创建配置文件
 * - 显示当前配置
 * - 显示配置文件路径
 * - 显示默认 JVM 配置
 */

import { Command, Help } from 'commander';
// 恢复 commander 默认 help 输出（不被 root 的 configureHelp 覆盖）
const defaultFormatHelp = (cmd: Command, helper: Help) => new Help().formatHelp(cmd, helper);
import * as fs from 'fs';
import { loadConfig, generateConfigTemplate, CONFIG_FILE, DEFAULT_JVM_CONFIG } from '../../jdtClient';

import { INIT_HELP, SHOW_HELP, PATH_HELP, DEFAULTS_HELP } from './help/configHelp';

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * 注册 config 命令
 */
export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('管理 JDT LSP CLI 配置。')
    .configureHelp({ formatHelp: defaultFormatHelp });

  // config init
  configCmd
    .command('init')
    .description('创建默认配置文件。')
    .configureHelp({ formatHelp: () => INIT_HELP })
    .option('-f, --force', '覆盖已有配置文件')
    .action((cmdOpts) => {
      if (fs.existsSync(CONFIG_FILE) && !cmdOpts.force) {
        console.log(`Config file already exists: ${CONFIG_FILE}`);
        console.log('Use --force to overwrite');
        process.exit(1);
      }
      generateConfigTemplate();
      console.log('You can now edit the config file to customize JVM parameters.');
    });

  // config show
  configCmd
    .command('show')
    .description('显示当前配置。')
    .configureHelp({ formatHelp: () => SHOW_HELP })
    .action(() => {
      const config = loadConfig();
      console.log(`Config file: ${CONFIG_FILE}`);
      console.log(`File exists: ${fs.existsSync(CONFIG_FILE)}`);
      console.log('');
      console.log('Current configuration:');
      console.log(JSON.stringify(config, null, 2));
    });

  // config path
  configCmd
    .command('path')
    .description('显示配置文件路径。')
    .configureHelp({ formatHelp: () => PATH_HELP })
    .action(() => {
      console.log(CONFIG_FILE);
    });

  // config defaults
  configCmd
    .command('defaults')
    .description('显示默认 JVM 配置。')
    .configureHelp({ formatHelp: () => DEFAULTS_HELP })
    .action(() => {
      console.log('Default JVM configuration:');
      console.log(JSON.stringify(DEFAULT_JVM_CONFIG, null, 2));
    });
}
