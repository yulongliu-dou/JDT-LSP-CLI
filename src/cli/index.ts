/**
 * CLI 命令注册
 * 
 * 统一注册所有 CLI 命令到 program
 */

import { Command } from 'commander';
import { registerDaemon } from './commands/daemon';
import { registerConfig } from './commands/config';
import { registerCallHierarchyCommand } from './commandHandlers';
import { registerDefinitionCommand } from './commands/definition';
import { registerReferencesCommand } from './commands/references';
import { registerSymbolsCommand } from './commands/symbols';
import { registerWorkspaceSymbolsCommand } from './commands/workspaceSearch';
import { registerTypeDefinitionCommand } from './commands/typeDefinition';
import { registerImplementationsCommand } from './commands/implementations';
import { registerHoverCommand } from './commands/hover';

/**
 * 注册所有 CLI 命令
 */
export function registerAllCommands(program: Command): void {
  // 注册 daemon 命令
  registerDaemon(program);
  
  // 注册 config 命令
  registerConfig(program);
  
  // 注册 LSP 命令
  registerCallHierarchyCommand(program);
  registerDefinitionCommand(program);
  registerReferencesCommand(program);
  registerSymbolsCommand(program);
  registerWorkspaceSymbolsCommand(program);
  registerTypeDefinitionCommand(program);
  registerImplementationsCommand(program);
  registerHoverCommand(program);
}
