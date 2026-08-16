const baseConfig = require('./jest.config');

module.exports = {
    ...baseConfig,
    setupFilesAfterEnv: [],
    testMatch: [
        '<rootDir>/tests/critical/**/*.test.js',
        '<rootDir>/tests/security/auth.middleware.test.js',
    ],
    // Alguns contratos críticos de outras PRs usam o runner nativo do Node
    // (require('node:test')) mas mantiveram a extensão .test.js — o Jest tenta
    // coletá-los pelo glob acima e falha por não encontrarem nenhum teste seu.
    // Cada um já roda pelo próprio script test:critical:* dedicado.
    testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/tests/critical/csrf-logout-contract.test.js',
        '<rootDir>/tests/critical/payment-report-contract.test.js',
    ],
};
