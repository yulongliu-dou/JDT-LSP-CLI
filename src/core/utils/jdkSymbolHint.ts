/**
 * JDK 符号识别与提示工具
 *
 * 用于在 workspace/symbol 搜不到结果时，给出 JDK 类/方法的友好提示。
 */

/** 常见 JDK 类名（简单名） */
const COMMON_JDK_CLASSES = new Set([
  'String', 'Object', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Byte', 'Short', 'Character',
  'ArrayList', 'LinkedList', 'HashMap', 'LinkedHashMap', 'TreeMap', 'HashSet', 'LinkedHashSet', 'TreeSet',
  'List', 'Map', 'Set', 'Collection', 'Iterator', 'Iterable', 'Comparable', 'Comparator',
  'Optional', 'Stream', 'Function', 'Consumer', 'Supplier', 'Predicate', 'BiFunction', 'BiConsumer',
  'Thread', 'Runnable', 'Callable', 'Future', 'CompletableFuture', 'Executor', 'ExecutorService',
  'Exception', 'RuntimeException', 'IllegalArgumentException', 'NullPointerException', 'IndexOutOfBoundsException',
  'System', 'Math', 'Objects', 'Arrays', 'Collections', 'StringBuilder', 'StringBuffer',
  'Calendar', 'Date', 'LocalDate', 'LocalDateTime', 'Instant', 'Duration', 'Period', 'ZoneId',
  'AtomicInteger', 'AtomicLong', 'AtomicBoolean', 'AtomicReference', 'ConcurrentHashMap',
  'BigDecimal', 'BigInteger', 'UUID', 'Random', 'Scanner',
  'Class', 'ClassLoader', 'Package', 'Module', 'Annotation',
  'Enum', 'Override', 'Deprecated', 'SuppressWarnings', 'SafeVarargs', 'FunctionalInterface',
  'Serializable', 'Externalizable', 'Cloneable',
  'CharSequence', 'Appendable', 'AutoCloseable', 'Closeable', 'Flushable',
  'Ref', 'PhantomReference', 'SoftReference', 'WeakReference', 'Cleaner',
  'StackTraceElement', 'Process', 'ProcessBuilder', 'ProcessHandle',
  'Runtime', 'ThreadLocal', 'InheritableThreadLocal', 'ThreadGroup',
  'SecurityManager', 'Permission', 'PrivilegedAction', 'AccessController',
  'WeakHashMap', 'IdentityHashMap', 'EnumMap', 'EnumSet',
  'BitSet', 'Vector', 'Hashtable', 'Stack', 'Dictionary',
  'Properties', 'StringTokenizer', 'Locale', 'Currency',
  'TimeZone', 'SimpleTimeZone', 'GregorianCalendar',
  'Formatter', 'PrintStream', 'PrintWriter',
  'BufferedReader', 'BufferedWriter', 'FileReader', 'FileWriter',
  'ByteArrayInputStream', 'ByteArrayOutputStream',
  'CharArrayReader', 'CharArrayWriter',
  'DataInputStream', 'DataOutputStream',
  'ObjectInputStream', 'ObjectOutputStream',
  'FileInputStream', 'FileOutputStream',
  'PipedInputStream', 'PipedOutputStream',
  'SequenceInputStream', 'PushbackInputStream',
  'StringReader', 'StringWriter',
  'FilterInputStream', 'FilterOutputStream',
  'InflaterInputStream', 'DeflaterOutputStream',
  'ZipInputStream', 'ZipOutputStream', 'ZipFile',
  'JarInputStream', 'JarOutputStream', 'JarFile',
  'GZIPInputStream', 'GZIPOutputStream',
  'Base64', 'MessageDigest', 'Cipher', 'Key', 'KeyPair',
  'SecureRandom', 'KeyStore', 'Certificate', 'CertPath',
  'SSLContext', 'SSLSocket', 'SSLServerSocket',
  'Connection', 'Statement', 'PreparedStatement',
  'ResultSet', 'DriverManager', 'DataSource',
  'DocumentBuilder', 'SAXParser', 'XPath', 'Transformer',
  'SocketAddress', 'InetSocketAddress', 'ServerSocket',
  'DatagramSocket', 'MulticastSocket',
  'URLConnection', 'URLClassLoader', 'JarURLConnection',
  'Proxy', 'ProxySelector', 'CookieManager',
  'HttpClient', 'HttpRequest', 'HttpResponse', 'HttpHeaders',
  'BodyPublisher', 'BodyHandler', 'BodySubscriber',
  'Flow', 'SubmissionPublisher',
  'VarHandle', 'MethodHandle', 'MethodHandles', 'MethodType',
  'Lookup', 'CallSite', 'ConstantCallSite', 'MutableCallSite',
  'VolatileCallSite', 'SwitchPoint',
  'Instrumentation', 'ClassFileTransformer',
  'Unsafe', 'Cleaner', 'Reference', 'ReferenceQueue',
  'Record', 'SequencedCollection', 'SequencedSet', 'SequencedMap',
]);

/** 常见 JDK 方法名 */
const COMMON_JDK_METHODS = new Set([
  'toString', 'equals', 'hashCode', 'clone', 'compareTo',
  'get', 'set', 'put', 'add', 'remove', 'clear', 'size', 'isEmpty', 'contains',
  'iterator', 'stream', 'forEach', 'map', 'filter', 'reduce', 'collect',
  'run', 'start', 'sleep', 'interrupt', 'join', 'yield', 'isAlive',
  'read', 'write', 'close', 'flush', 'skip', 'reset', 'mark',
  'charAt', 'substring', 'indexOf', 'lastIndexOf', 'replace', 'split', 'trim',
  'append', 'insert', 'delete', 'reverse',
  'format', 'printf', 'println', 'print',
  'parse', 'valueOf', 'toUpperCase', 'toLowerCase', 'matches',
  'wait', 'notify', 'notifyAll',
  'getClass', 'finalize',
  'apply', 'accept', 'test', 'getAsInt', 'getAsLong', 'getAsDouble',
  'thenApply', 'thenAccept', 'thenCompose', 'whenComplete', 'exceptionally',
  'of', 'ofNullable', 'ifPresent', 'orElse', 'orElseGet', 'orElseThrow',
  'isPresent', 'isEmpty',
  'compose', 'andThen', 'and', 'or', 'negate',
  'min', 'max', 'sum', 'average', 'count', 'findFirst', 'findAny', 'anyMatch', 'allMatch', 'noneMatch',
  'concat', 'distinct', 'sorted', 'limit', 'skip', 'peek', 'flatMap',
  'abs', 'ceil', 'floor', 'round', 'sqrt', 'pow', 'log', 'exp', 'sin', 'cos', 'tan',
  'copyOf', 'copyOfRange', 'fill', 'sort', 'binarySearch', 'asList',
  'requireNonNull', 'requireNonNullElse', 'isNull', 'nonNull',
  'deepEquals', 'deepHashCode', 'deepToString',
  'identity', 'empty', 'ofEntries',
]);

/**
 * 判断查询词是否可能是 JDK 核心类/方法。
 *
 * 规则（按优先级）：
 * 1. 全限定名以 java / javax / jdk / com.sun / sun 开头 → 一定是 JDK
 * 2. 常见 JDK 简单类名（大驼峰）→ 可能是 JDK Class/Interface
 * 3. 常见 JDK 方法名（小驼峰）→ 可能是 JDK Method
 */
export function looksLikeJdkSymbol(name: string, kind?: string): boolean {
  if (!name) return false;

  // 规则 1：全限定 JDK 包名
  if (/^(java|javax|jdk|com\.sun|sun)\./.test(name)) return true;

  // 规则 2：常见 JDK 类名
  if (COMMON_JDK_CLASSES.has(name)) return true;

  // 规则 3：常见 JDK 方法名
  if (COMMON_JDK_METHODS.has(name)) return true;

  // 规则 4：如果 kind 明确是 Class/Interface 且名字是大驼峰，追加一些常见模式
  if (kind === 'Class' || kind === 'Interface' || kind === 'Enum') {
    if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      // 以常见 JDK 包名缩写或类型后缀结尾的也纳入
      if (/^(Abstract|Base|Basic|Default|Simple|Standard|Generic|Unsafe|Strict|Native)/.test(name)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 生成 JDK 符号未找到的友好提示。
 */
export function buildJdkHint(symbolName: string, kind?: string): string {
  const kindLabel = kind ? `${kind.toLowerCase()} ` : '';
  return (
    `Note: JDK core ${kindLabel}symbols may not be indexed by workspace/symbol. ` +
    `To view JDK source, use 'jls def <file> --symbol ${symbolName}' from a source file reference, ` +
    `or browse with your IDE after opening the project.`
  );
}
