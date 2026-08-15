import { defineConfig } from 'vitest/config';

// Suíte Jest legada (usa jest.mock / jest.fn) — roda via `npm test`, não no Vitest.
const jestLegacySuite = [
  'tests/unit/parcel.service.test.js',
  'tests/unit/parcel.review.test.js',
  'tests/unit/parcel.payment.test.js',
  'tests/unit/presentialRide.service.test.js',
  'tests/unit/schedule.phase1.test.js',
  'tests/unit/schedule.phase2.test.js',
  'tests/unit/schedule.phase3.test.js',
  'tests/unit/schedule.phase4.test.js',
  'tests/unit/schedule.service.test.js',
  'tests/unit/schedule.dispatchEligibility.test.js',
  'tests/unit/upload.service.test.js',
  'tests/unit/captainFinancialHistory.service.test.js',
  'tests/unit/presentialFinishDestination.service.test.js',
  'tests/unit/reportServiceChargedFare.service.test.js',
  'tests/integration/schedule.api.test.js',
  'tests/integration/chat.delivery.test.js',
  'tests/security/**',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: [
      '**/node_modules/**',
      ...jestLegacySuite,
      // Integração/sockets flaky ou acoplados a estado global — gate do CI fica nas units Vitest.
      'tests/integration/**',
      'tests/sockets/**',
      // Contratos de segurança COR-2001 têm runners próprios (node:test + Jest).
      'tests/critical/**',
      // Simulador E2E MoveCity (2026-08-08): usa jest.mock/jest real (socket.io-client +
      // supertest + MongoMemoryReplSet), mesmo motivo de tests/sockets acima — não é o
      // gate do CI, roda via `npm run test:movecity`.
      'tests/e2e-simulator/**',
      // Contratos críticos usam o runner nativo do Node para não depender de banco.
      // Cada contrato entra no CI pelo script dedicado correspondente.
      'tests/critical/**',
      'tests/auth.test.js',
      'tests/performance/**',
    ],
  },
});

