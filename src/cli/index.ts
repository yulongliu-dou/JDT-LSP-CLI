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
import { registerDiagnosticsCommand } from './commands/diagnostics';
import { registerRenameCommand } from './commands/rename';
import { registerSemanticTokensCommand } from './commands/semanticTokens';
import { registerInlayHintCommand } from './commands/inlayHint';
import { registerCodeActionCommand } from './commands/codeAction';
import { registerDocumentHighlightCommand } from './commands/documentHighlight';
import { registerCodeLensCommand } from './commands/codeLens';
import { registerCompletionCommand } from './commands/completion';
import { registerSignatureHelpCommand } from './commands/signatureHelp';
import { registerDeclarationCommand } from './commands/declaration';
import { registerFormattingCommand } from './commands/formatting';
import { registerPrepareRenameCommand } from './commands/prepareRename';
import { registerCache } from './commands/cache';
import { registerJre } from './commands/jre';
import { registerJdt } from './commands/jdt';
import { ROOT_HELP } from './commands/help/rootHelp';

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * 注册所有 CLI 命令
 */
export function registerAllCommands(program: Command): void {
  // 接管全局 help 输出
  program.configureHelp({ formatHelp: () => ROOT_HELP });

  // 注册 daemon 命令
  registerDaemon(program);

  // 注册 config 命令
  registerConfig(program);

  // 注册 jre 命令
  registerJre(program);

  // 注册 jdt 命令
  registerJdt(program);

  // 注册 LSP 命令
  registerCallHierarchyCommand(program);
  registerDefinitionCommand(program);
  registerReferencesCommand(program);
  registerSymbolsCommand(program);
  registerWorkspaceSymbolsCommand(program);
  registerTypeDefinitionCommand(program);
  registerImplementationsCommand(program);
  registerHoverCommand(program);
  registerDiagnosticsCommand(program);
  registerRenameCommand(program);
  registerSemanticTokensCommand(program);
  registerInlayHintCommand(program);
  registerCodeActionCommand(program);
  registerDocumentHighlightCommand(program);
  registerCodeLensCommand(program);
  registerCompletionCommand(program);
  registerSignatureHelpCommand(program);
  registerDeclarationCommand(program);
  registerFormattingCommand(program);
  registerPrepareRenameCommand(program);

  // 注册 cache 命令（SP04）
  registerCache(program);
}
