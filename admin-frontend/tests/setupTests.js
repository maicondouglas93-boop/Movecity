import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';

// Inicia o MSW antes dos testes
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Limpa os handlers após cada teste
afterEach(() => server.resetHandlers());

// Desliga o servidor MSW
afterAll(() => server.close());
