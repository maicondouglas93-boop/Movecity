module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/setup.js'],
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/integration/**/*.test.js',
    '**/tests/sockets/**/*.test.js',
    '**/tests/security/**/*.test.js',
    '**/tests/e2e-simulator/**/*.test.js'
  ],
  moduleNameMapper: {
    '^firebase-admin$': '<rootDir>/tests/mocks/firebase-admin.mock.js',
    '^firebase-admin/auth$': '<rootDir>/tests/mocks/firebase-admin.mock.js',
    '^uuid$': '<rootDir>/tests/mocks/uuid.mock.js',
    '^@imagekit/nodejs$': '<rootDir>/tests/mocks/imagekit.mock.js'
  },
  collectCoverageFrom: [
    'src/**/*.js',
    'models/**/*.js',
    'services/**/*.js',
    'controllers/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/vendor/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './services/': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './controllers/': {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    }
  },
  testTimeout: 30000 // 30 seconds for longer integration tests like DB setup
};
