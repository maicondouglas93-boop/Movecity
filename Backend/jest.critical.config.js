const baseConfig = require('./jest.config');

module.exports = {
    ...baseConfig,
    setupFilesAfterEnv: [],
    testMatch: [
        '<rootDir>/tests/security/auth.middleware.test.js',
    ],
};
