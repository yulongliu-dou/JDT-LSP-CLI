/**
 * JDK Runtime 检测器
 *
 * 判定一个 jdt:// container 或 fqcn 是否属于 JDK 内置类（jrt-fs.jar / java.* / jdk.* 等）。
 * 命中 JDK 直接走 JdkSourceProvider 快速通道（$JAVA_HOME/lib/src.zip）。
 *
 * 参见：[SP01 子计划 Task 1.4](file:///e:/LSP_Scripy/jdt-lsp-cli/.qoder/plans/jar-class-locator/SP01-%E9%AA%A8%E6%9E%B6%E4%B8%8EJDT%E5%85%9C%E5%BA%95_a1b2c3d4.md)
 */

/**
 * 判断 container 是否为 JDK 内置
 *
 * @param container jdt:// URI 中的 container 段
 */
export function isJdkContainer(container: string): boolean {
  if (!container) {
    return false;
  }
  const lower = container.toLowerCase();
  if (lower.endsWith('jrt-fs.jar') || lower.endsWith('.jmod') || lower === 'rt.jar' || lower.endsWith('/rt.jar') || lower.endsWith('\\rt.jar')) {
    return true;
  }
  if (lower.includes('/jre/lib/') || lower.includes('\\jre\\lib\\')) {
    return true;
  }
  if (lower.includes('/jmods/') || lower.includes('\\jmods\\')) {
    return true;
  }
  // JDK 9+ 模块名形式（java.base / jdk.compiler 等）也可能直接作为 container 出现
  if (/^(java|jdk)\.[a-z0-9_.]+$/.test(lower)) {
    return true;
  }
  return false;
}

/**
 * 判断 fqcn 是否属于 JDK 命名空间
 */
export function isJdkFqcn(fqcn: string): boolean {
  if (!fqcn) {
    return false;
  }
  return (
    fqcn.startsWith('java.') ||
    fqcn.startsWith('javax.') ||
    fqcn.startsWith('jdk.') ||
    fqcn.startsWith('com.sun.') ||
    fqcn.startsWith('sun.') ||
    fqcn.startsWith('org.w3c.') ||
    fqcn.startsWith('org.xml.') ||
    fqcn.startsWith('org.omg.') ||
    fqcn.startsWith('org.ietf.')
  );
}

/**
 * 组合判定：container 或 fqcn 命中任一即视为 JDK
 */
export function isJdk(container: string, fqcn: string): boolean {
  return isJdkContainer(container) || isJdkFqcn(fqcn);
}

/**
 * 根据 fqcn 推断模块名（仅在 JDK 9+ 模块化布局下有意义）
 *
 * 简单规则：
 * - java.lang.*       → java.base
 * - java.util.*       → java.base
 * - java.io.*         → java.base
 * - java.nio.*        → java.base
 * - java.net.*        → java.base
 * - java.math.*       → java.base
 * - java.sql.*        → java.sql
 * - java.desktop / awt / swing → java.desktop
 * - 默认：返回 null，调用方退化为遍历搜索
 *
 * 若无法精确推断，返回 null；由调用方通过扫描 src.zip 顶层目录查找。
 */
export function inferJdkModule(fqcn: string): string | null {
  if (!fqcn) return null;
  const base = ['java.lang', 'java.util', 'java.io', 'java.nio', 'java.net', 'java.math', 'java.time', 'java.text', 'java.security'];
  for (const pkg of base) {
    if (fqcn === pkg || fqcn.startsWith(pkg + '.')) {
      return 'java.base';
    }
  }
  if (fqcn.startsWith('java.sql.') || fqcn === 'java.sql') return 'java.sql';
  if (fqcn.startsWith('java.desktop.') || fqcn.startsWith('java.awt.') || fqcn.startsWith('javax.swing.')) return 'java.desktop';
  if (fqcn.startsWith('java.logging.') || fqcn.startsWith('java.util.logging.')) return 'java.logging';
  if (fqcn.startsWith('java.xml.') || fqcn.startsWith('javax.xml.')) return 'java.xml';
  return null;
}
