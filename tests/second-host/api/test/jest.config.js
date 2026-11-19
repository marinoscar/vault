/** @type {import('jest').Config} Host Beta's API suites (real PostgreSQL; see test/host-database.ts). */
module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } }],
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 60000,
};
