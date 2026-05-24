/**
 * 解码 LSP SemanticTokens delta 编码数据为人类可读的 token 列表。
 */
export function decodeSemanticTokens(
  raw: any,
  legend?: { tokenTypes: string[]; tokenModifiers: string[] } | null
): { tokens: any[]; count: number; resultId?: string } {
  const data = raw?.data;
  if (!data || !Array.isArray(data)) return { tokens: [], count: 0 };

  const tokenTypeNames = legend?.tokenTypes || [];
  const tokenModifierNames = legend?.tokenModifiers || [];

  const tokens: any[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaStartChar = data[i + 1];
    const length = data[i + 2];
    const tokenType = data[i + 3];
    const tokenModifiers = data[i + 4];

    const line = deltaLine === 0 ? prevLine : prevLine + deltaLine;
    const startChar = deltaLine === 0 ? prevChar + deltaStartChar : deltaStartChar;

    const decodedModifiers: string[] = [];
    if (tokenModifierNames.length > 0) {
      for (let bit = 0; bit < tokenModifierNames.length; bit++) {
        if (tokenModifiers & (1 << bit)) {
          decodedModifiers.push(tokenModifierNames[bit]);
        }
      }
    }

    tokens.push({
      line,
      startChar,
      length,
      tokenType: tokenTypeNames[tokenType] || tokenType,
      tokenModifiers: decodedModifiers.length > 0 ? decodedModifiers : tokenModifiers,
    });

    prevLine = line;
    prevChar = startChar;
  }

  return { tokens, count: tokens.length, resultId: raw.resultId };
}
