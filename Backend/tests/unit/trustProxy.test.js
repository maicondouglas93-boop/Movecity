const express = require('express');
const request = require('supertest');

// Plano de correção (Fase 1.3, 2026-08-16): sem 'trust proxy' configurado, req.ip é
// sempre o endereço interno do proxy do Render (o mesmo pra todo mundo), nunca o do
// cliente — o rate limiter por IP (loginLimiter etc.) fica cego. Testa o exato valor
// configurado em app.js ('1', um hop confiável) contra o algoritmo real do Express/
// proxy-addr, isolado do app completo pra não depender de infraestrutura real da Render.
describe('trust proxy = 1 (mesma configuração de app.js)', () => {
    const buildApp = () => {
        const app = express();
        app.set('trust proxy', 1);
        app.get('/ip', (req, res) => res.json({ ip: req.ip }));
        return app;
    };

    it('sem X-Forwarded-For, usa o endereço real da conexão', async () => {
        const app = buildApp();
        const res = await request(app).get('/ip');
        expect(res.body.ip).toBeTruthy();
    });

    it('com um hop confiável, usa o IP que o proxy anexou (não o que o cliente mandou)', async () => {
        const app = buildApp();
        // Um cliente malicioso tentando se passar por outro IP só teria efeito se
        // existisse um SEGUNDO hop confiável — com trust proxy=1, o valor efetivo é o
        // último da cadeia (o que o proxy real, mais próximo da origem, anexou).
        const res = await request(app)
            .get('/ip')
            .set('X-Forwarded-For', '9.9.9.9, 8.8.8.8');

        expect(res.body.ip).toBe('8.8.8.8');
        expect(res.body.ip).not.toContain('9.9.9.9');
    });

    it('sem trust proxy configurado (comportamento anterior), X-Forwarded-For é ignorado', async () => {
        const app = express();
        app.get('/ip', (req, res) => res.json({ ip: req.ip }));

        const res = await request(app)
            .get('/ip')
            .set('X-Forwarded-For', '9.9.9.9');

        // Sem trust proxy, req.ip é sempre o socket da conexão — nunca o header. Isso
        // é exatamente o "cego pra IP real" que motivou a correção.
        expect(res.body.ip).not.toBe('9.9.9.9');
    });
});
