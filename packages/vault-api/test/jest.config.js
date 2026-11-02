/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        // TS151002: NodeNext suggests isolatedModules, which conflicts with emitDecoratorMetadata.
        // The package is "type": "commonjs", so NodeNext resolves to CommonJS.
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  testEnvironment: 'node',
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 30000,
};
