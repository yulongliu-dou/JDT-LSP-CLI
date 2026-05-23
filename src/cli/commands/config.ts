/**
 * Config 命令处理
 * 
 * 负责：
 * - 创建配置文件
 * - 显示当前配置
 * - 显示配置文件路径
 * - 显示默认 JVM 配置
 */

import { Command } from 'commander';
import * as fs from 'fs';
import { loadConfig, generateConfigTemplate, CONFIG_FILE, DEFAULT_JVM_CONFIG } from '../../jdtClient';

// ── Help ──────────────────────────────────────────────────────────────────────

const INIT_HELP = `
Usage: jls config init [options]

创建默认配置文件 ~/.jdt-lsp/config.json。

Options:
  -f, --force   覆盖已有配置文件
  -h, --help    显示帮助

Examples:
  jls config init
  jls config init --force
`;

const SHOW_HELP = `
Usage: jls config show

显示当前完整配置（JSON 格式）。
`;

const PATH_HELP = `
Usage: jls config path

显示配置文件的绝对路径。
`;

const DEFAULTS_HELP = `
Usage: jls config defaults

显示默认 JVM 配置。
`;

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * 注册 config 命令
 */
export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('管理 JDT LSP CLI 配置。');

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
