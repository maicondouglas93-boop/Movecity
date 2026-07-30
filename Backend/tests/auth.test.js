const request = require('supertest');
const app = require('../app'); // O seu app Express (sem estar escutando porta)
const AdminUser = require('../models/adminUser.model');
const jwt = require('jsonwebtoken');

describe('Testes de Permissão de Admin (JWT Auth)', () => {
    let superAdminToken;
    let operatorToken;
    
    beforeAll(async () => {
        // Mock do app se não exportar do server.js
        if (!app) {
            console.warn("App Express não encontrado. Importe corretamente de server.js ou app.js");
        }
    });

    beforeEach(async () => {
        // Criar admins no banco em memória
        const superAdmin = await AdminUser.create({
            name: 'Super Test',
            email: 'super@test.com',
            password: 'password123',
            role: 'super_admin'
        });
        const operator = await AdminUser.create({
            name: 'Operator Test',
            email: 'operator@test.com',
            password: 'password123',
            role: 'operador'
        });

        superAdminToken = jwt.sign({ _id: superAdmin._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
        operatorToken = jwt.sign({ _id: operator._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
    });

    it('Deve bloquear acesso sem token', async () => {
        const res = await request(app).get('/admin/users');
        expect(res.statusCode).toBe(401);
    });

    it('Deve bloquear acesso com token inválido', async () => {
        const res = await request(app).get('/admin/users').set('Authorization', 'Bearer tokenFalso123');
        expect(res.statusCode).toBe(401);
    });

    it('Deve bloquear rota protegida para operador que exige super_admin', async () => {
        // Ex: Rota /admin/logs é apenas para super_admin
        const res = await request(app).get('/admin/logs').set('Authorization', `Bearer ${operatorToken}`);
        expect(res.statusCode).toBe(403);
    });

    it('Deve permitir acesso a operador em rota permitida', async () => {
        // Ex: Rota /admin/users é permitida para super e operador
        const res = await request(app).get('/admin/users').set('Authorization', `Bearer ${operatorToken}`);
        expect([200, 404]).toContain(res.statusCode); // Dependendo de ter ou não dados
    });
});
