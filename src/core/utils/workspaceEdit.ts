/**
 * 将 LSP WorkspaceEdit 扁平化为统一的 changes 数组。
 * 同时处理 changes (uri→TextEdit[]) 和 documentChanges (TextDocumentEdit[]) 两种格式。
 */
export function flattenWorkspaceEdit(workspaceEdit: any): { changes: any[]; count: number } {
  const changes: any[] = [];

  if (workspaceEdit?.changes) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes) as [string, any[]][]) {
      for (const edit of edits) {
        changes.push({ file: uri, range: edit.range, newText: edit.newText });
      }
    }
  }

  if (workspaceEdit?.documentChanges) {
    for (const docChange of workspaceEdit.documentChanges) {
      if (docChange.textDocument && docChange.edits) {
        for (const edit of docChange.edits) {
          changes.push({
            file: docChange.textDocument.uri,
            range: edit.range,
            newText: edit.newText,
          });
        }
      }
    }
  }

  return { changes, count: changes.length };
}
