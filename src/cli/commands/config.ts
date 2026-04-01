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

/**
 * 注册 config 命令
 */
export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage JDT LSP CLI configuration');

  // config init
  configCmd
    .command('init')
    .description('Create default configuration file')
    .option('-f, --force', 'Overwrite existing config file')
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
    .description('Show current configuration')
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
    .description('Show configuration file path')
    .action(() => {
      console.log(CONFIG_FILE);
    });

  // config defaults
  configCmd
    .command('defaults')
    .description('Show default JVM configuration')
    .action(() => {
      console.log('Default JVM configuration:');
      console.log(JSON.stringify(DEFAULT_JVM_CONFIG, null, 2));
    });
}
