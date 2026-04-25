module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: [
    '**/*.test.ts',
    '!**/node_modules/**'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      sourceMap: true,
      // 启用缓存加速编译（方案 F）
      cache: true,
      cacheDirectory: '<rootDir>/.jest-cache',
      // 使用 isolatedModules 模式加速（跳过类型检查）
      isolatedModules: true,
      // 诊断级别：减少输出
      diagnostics: {
        warnOnly: true,
        ignoreCodes: [151001],
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/cli.ts',
    '!src/daemon.ts',
    '!src/daemon-process.ts',
    '!src/index.ts',
    '!src/jdtClient.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  // 测试超时设置（E2E测试可能需要更长时间）
  testTimeout: 60000,
  // .verbose 输出
  verbose: true,
  // 设置路径映射
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  // 忽略某些路径
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/test/',
    '/dist/',
  ],
  // 缓存配置（方案 F）
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  // Worker 配置（为未来并行执行预留）
  // maxWorkers: '50%', // E2E 测试需要串行，单元测试可启用
};
