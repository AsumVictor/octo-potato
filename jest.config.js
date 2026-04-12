/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: [
    'modules/**/*.js',
    '!modules/ui/StyleInjector.js',   // pure CSS strings, not worth instrumenting
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // jest-junit writes junit.xml for Jenkins to consume
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: '.', outputName: 'junit.xml' }]
  ]
};
