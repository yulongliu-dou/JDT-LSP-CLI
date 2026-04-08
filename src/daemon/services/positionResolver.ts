/**
 * 位置解析服务
 * 
 * 负责解析符号位置，支持符号模式和传统行列模式
 */

import * as fs from 'fs';
import { JdtLsClient } from '../../jdtClient';
import { CLIResult, SymbolInfo } from '../../core/types';
import { resolveSymbol, buildSymbolQuery } from '../../symbolResolver';

/**
 * 解析符号位置（如果使用符号模式）
 */
export async function resolvePosition(
  body: any,
  client: JdtLsClient
): Promise<{ line: number; col: number } | CLIResult<any>> {
  // 检查是否使用符号模式
  const symbolQuery = buildSymbolQuery({
    method: body.method,
    symbol: body.symbol,
    container: body.container,
    signature: body.signature,
    index: body.index,
    kind: body.kind,
  });
  
  if (!symbolQuery) {
    // 传统模式：使用行列参数
    if (!body.line || !body.col) {
      return {
        success: false,
        error: 'Position required: either provide line/col or use method/symbol parameter',
        elapsed: 0,
      };
    }
    
    const lineNum = parseInt(body.line);
    const colNum = parseInt(body.col);
    
    // 验证行号和列号的有效性
    if (isNaN(lineNum) || lineNum < 1) {
      return {
        success: false,
        error: `Invalid line number: ${body.line}. Line number must be a positive integer.`,
        elapsed: 0,
      };
    }
    
    if (isNaN(colNum) || colNum < 1) {
      return {
        success: false,
        error: `Invalid column number: ${body.col}. Column number must be a positive integer.`,
        elapsed: 0,
      };
    }
    
    // 检查行号是否超出文件范围
    if (body.file) {
      try {
        const fileContent = fs.readFileSync(body.file, 'utf-8');
        const lines = fileContent.split('\n');
        if (lineNum > lines.length) {
          return {
            success: false,
            error: `Line number ${lineNum} exceeds file length (${lines.length} lines).`,
            elapsed: 0,
          };
        }
        // 检查列号是否超出该行长度
        const targetLine = lines[lineNum - 1];
        if (colNum > targetLine.length + 1) {
          return {
            success: false,
            error: `Column number ${colNum} exceeds line ${lineNum} length (${targetLine.length} characters).`,
            elapsed: 0,
          };
        }
      } catch (error: any) {
        // 如果无法读取文件，继续执行
      }
    }
    
    return { line: lineNum, col: colNum };
  }
  
  // 符号模式：先获取文档符号，再解析位置
  const symbols: SymbolInfo[] = await client.getDocumentSymbols(body.file);
  const result = resolveSymbol(symbols, symbolQuery);
  
  if (!result.success) {
    return {
      success: false,
      error: result.error.message,
      data: { resolution_error: result.error },
      elapsed: 0,
    };
  }
  
  return {
    line: result.position.line,
    col: result.position.character,
  };
}
