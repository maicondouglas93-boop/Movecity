const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');

// Plano de correção (Fase 2.1, Passo 1, 2026-08-16): /api/health sempre respondia 200
// mesmo com o Mongo desconectado — o Render não tinha como saber que o backend estava
// inutilizável. /api/ready é a versão que realmente checa o banco. Ainda não é o que o
// Render usa (isso é o Passo 4, depois de observar em produção) — este teste cobre só
// o endpoint em si.
describe('GET /api/ready', () => {
    it('responde 200 quando o Mongo está conectado', async () => {
        expect(mongoose.connection.readyState).toBe(1);

        const res = await request(app).get('/api/ready');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ready');
        expect(res.body.databaseState).toBe('connected');
    });

    it('responde 503 quando o Mongo NÃO está conectado', async () => {
        const original = mongoose.connection.readyState;
        try {
            mongoose.connection.readyState = 0;

            const res = await request(app).get('/api/ready');

            expect(res.status).toBe(503);
            expect(res.body.status).toBe('not_ready');
            expect(res.body.databaseState).toBe('disconnected');
        } finally {
            mongoose.connection.readyState = original;
        }
    });

    it('GET /api/health continua sempre 200, mesmo desconectado (liveness, não muda)', async () => {
        const original = mongoose.connection.readyState;
        try {
            mongoose.connection.readyState = 0;

            const res = await request(app).get('/api/health');

            expect(res.status).toBe(200);
            expect(res.body.databaseState).toBe('disconnected');
        } finally {
            mongoose.connection.readyState = original;
        }
    });
});
