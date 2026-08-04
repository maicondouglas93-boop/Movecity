const request = require('supertest');
const app = require('../../app');
const captainModel = require('../../models/captain.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const { generateAuthToken } = require('../setup/authHelper');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const captainService = require('../../services/captain.service');
const adminService = require('../../services/admin.service');
const { expireOverdueCaptains, sendDeadlineReminders } = require('../../services/captainDeadline.service');
const Notification = require('../../models/notification.model');

// Simplificação do cadastro do motorista + prazo de 5 dias (2026-08-04).
const fakeAdmin = { _id: '000000000000000000000001', name: 'Admin Teste' };

describe('Cadastro simplificado do motorista', () => {
    it('cadastro com só conta + veículo funciona, sem CPF/telefone/CNH/PIX', async () => {
        await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true, capacity: 4 });

        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Simples', lastname: 'Assim' },
                email: 'simples@example.com',
                password: 'senha123',
                vehicle: {
                    marca: 'Fiat',
                    modelo: 'Mobi',
                    ano: 2022,
                    color: 'branco',
                    plate: 'SIM1234',
                    vehicleType: 'car'
                }
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.captain.email).toBe('simples@example.com');
        expect(res.body.captain.approvalStatus).toBe('iniciado');

        const dbCaptain = await captainModel.findOne({ email: 'simples@example.com' });
        expect(dbCaptain.phone).toBeFalsy();
        expect(dbCaptain.cpf).toBeFalsy();
        // capacity veio da categoria (4), não foi pedido no formulário.
        expect(dbCaptain.vehicle.capacity).toBe(4);
    });

    it('e-mail inválido é rejeitado com 400', async () => {
        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Teste' },
                email: 'nao-e-email',
                password: 'senha123',
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'ABC1234', vehicleType: 'car' }
            });
        expect(res.statusCode).toBe(400);
    });

    it('e-mail duplicado é rejeitado', async () => {
        await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true, capacity: 4 });
        await createCaptain({ email: 'duplicado@example.com' });

        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Teste' },
                email: 'duplicado@example.com',
                password: 'senha123',
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'DUP1234', vehicleType: 'car' }
            });
        expect(res.statusCode).toBe(400);
    });

    it('senha curta é rejeitada', async () => {
        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Teste' },
                email: 'senhacurta@example.com',
                password: '123',
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'ABC1234', vehicleType: 'car' }
            });
        expect(res.statusCode).toBe(400);
    });

    it('veículo incompleto (sem marca) é rejeitado mesmo chamando a API direto', async () => {
        await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true, capacity: 4 });

        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Teste' },
                email: 'semveiculo@example.com',
                password: 'senha123',
                vehicle: { modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'ABC1234', vehicleType: 'car' }
            });
        expect(res.statusCode).toBe(400);
    });

    it('categoria de veículo inexistente é rejeitada', async () => {
        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Teste' },
                email: 'catinexistente@example.com',
                password: 'senha123',
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'ABC1234', vehicleType: 'fantasma' }
            });
        expect(res.statusCode).toBe(400);
    });

    it('placa em formato inválido é rejeitada', async () => {
        await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true, capacity: 4 });

        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Teste' },
                email: 'placainvalida@example.com',
                password: 'senha123',
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: '123', vehicleType: 'car' }
            });
        expect(res.statusCode).toBe(400);
    });

    it('approvalStatus/documentDeadline enviados pelo cliente no cadastro são ignorados', async () => {
        await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true, capacity: 4 });
        const forgedDeadline = new Date(Date.now() + 999 * 24 * 60 * 60 * 1000).toISOString();

        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Malicioso' },
                email: 'forjado@example.com',
                password: 'senha123',
                approvalStatus: 'aprovado',
                documentDeadline: forgedDeadline,
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'FOR1234', vehicleType: 'car' }
            });

        expect(res.statusCode).toBe(201);
        const dbCaptain = await captainModel.findOne({ email: 'forjado@example.com' });
        expect(dbCaptain.approvalStatus).toBe('iniciado');
        expect(new Date(dbCaptain.documentDeadline).toISOString()).not.toBe(forgedDeadline);
    });
});

describe('Prazo de documentação (documentDeadline)', () => {
    it('é calculado pelo backend como createdAt + 5 dias', async () => {
        await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true, capacity: 4 });

        const before = Date.now();
        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Prazo' },
                email: 'prazo5dias@example.com',
                password: 'senha123',
                vehicle: { marca: 'Fiat', modelo: 'Mobi', ano: 2022, color: 'branco', plate: 'PRZ1234', vehicleType: 'car' }
            });
        const after = Date.now();

        const dbCaptain = await captainModel.findOne({ email: 'prazo5dias@example.com' });
        const deadlineMs = new Date(dbCaptain.documentDeadline).getTime();
        const createdMs = new Date(dbCaptain.createdAt).getTime();
        const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

        expect(deadlineMs).toBeGreaterThanOrEqual(before + fiveDaysMs - 1000);
        expect(deadlineMs).toBeLessThanOrEqual(after + fiveDaysMs + 1000);
        expect(Math.abs(deadlineMs - createdMs - fiveDaysMs)).toBeLessThan(1000);
    });

    it('GET /captains/profile devolve o documentDeadline real do motorista', async () => {
        const captain = await createCaptain({ documentDeadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) });
        const token = generateAuthToken(captain, 'captain');

        const res = await request(app)
            .get('/captains/profile')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.captain.documentDeadline).toBeTruthy();
    });
});

describe('Expiração automática do prazo (cron)', () => {
    it('motorista com prazo vencido e status "iniciado" vira "expirado"', async () => {
        const captain = await createCaptain({
            approvalStatus: 'iniciado',
            documentDeadline: new Date(Date.now() - 60 * 1000) // venceu há 1 minuto
        });

        const count = await expireOverdueCaptains();
        expect(count).toBeGreaterThanOrEqual(1);

        const persisted = await captainModel.findById(captain._id);
        expect(persisted.approvalStatus).toBe('expirado');
    });

    it('motorista já "aprovado" com prazo vencido NÃO é expirado', async () => {
        const captain = await createCaptain({
            approvalStatus: 'aprovado',
            documentDeadline: new Date(Date.now() - 60 * 1000)
        });

        await expireOverdueCaptains();

        const persisted = await captainModel.findById(captain._id);
        expect(persisted.approvalStatus).toBe('aprovado');
    });

    it('motorista com prazo ainda válido não é expirado', async () => {
        const captain = await createCaptain({
            approvalStatus: 'iniciado',
            documentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });

        await expireOverdueCaptains();

        const persisted = await captainModel.findById(captain._id);
        expect(persisted.approvalStatus).toBe('iniciado');
    });

    it('lembrete de prazo terminando é enviado uma única vez', async () => {
        const captain = await createCaptain({
            approvalStatus: 'iniciado',
            documentDeadline: new Date(Date.now() + 12 * 60 * 60 * 1000), // faltam 12h
            documentDeadlineReminderSent: false
        });

        const firstRun = await sendDeadlineReminders();
        expect(firstRun).toBeGreaterThanOrEqual(1);

        const afterFirst = await captainModel.findById(captain._id);
        expect(afterFirst.documentDeadlineReminderSent).toBe(true);

        const secondRun = await sendDeadlineReminders();
        expect(secondRun).toBe(0);
    });
});

describe('Segurança — aceitar corrida sem documentação aprovada', () => {
    it('motorista com approvalStatus diferente de "aprovado" recebe 403 ao chamar accept diretamente', async () => {
        const captain = await createCaptain({ approvalStatus: 'iniciado' });
        const token = generateAuthToken(captain, 'captain');
        const ride = await createRide({ status: 'requested' });

        const res = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toMatch(/Documentação pendente/i);

        const persisted = await require('../../models/ride.model').findById(ride._id);
        expect(persisted.status).toBe('requested');
    });

    it('motorista "expirado" também é barrado de aceitar corrida', async () => {
        const captain = await createCaptain({ approvalStatus: 'expirado' });
        const token = generateAuthToken(captain, 'captain');
        const ride = await createRide({ status: 'requested' });

        const res = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(403);
    });

    it('motorista aprovado consegue aceitar normalmente (não quebrou o fluxo existente)', async () => {
        const captain = await createCaptain({ approvalStatus: 'aprovado' });
        const token = generateAuthToken(captain, 'captain');
        const ride = await createRide({ status: 'requested' });

        const res = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
    });

    it('toggle-online continua bloqueado para quem não está aprovado (comportamento pré-existente preservado)', async () => {
        const captain = await createCaptain({ approvalStatus: 'iniciado' });
        const token = generateAuthToken(captain, 'captain');

        const res = await request(app)
            .post('/captains/toggle-online')
            .set('Authorization', `Bearer ${token}`)
            .send({ isOnline: true });

        expect(res.statusCode).toBe(403);
    });
});

describe('PATCH /captains/document-info', () => {
    it('sem autenticação retorna 401', async () => {
        const res = await request(app)
            .patch('/captains/document-info')
            .send({ cnh: { number: '123' } });
        expect(res.statusCode).toBe(401);
    });

    it('grava só CNH sem exigir PIX (envio parcial permitido)', async () => {
        const captain = await createCaptain();
        const token = generateAuthToken(captain, 'captain');

        const res = await request(app)
            .patch('/captains/document-info')
            .set('Authorization', `Bearer ${token}`)
            .send({ cnh: { number: 'CNH12345', category: 'B', expiration: '2030-01-01' } });

        expect(res.statusCode).toBe(200);
        const persisted = await captainModel.findById(captain._id);
        expect(persisted.cnh.number).toBe('CNH12345');
        expect(persisted.pix?.key).toBeFalsy();
    });

    it('grava PIX sem mexer na CNH já salva', async () => {
        const captain = await createCaptain();
        await captainModel.findByIdAndUpdate(captain._id, { 'cnh.number': 'JA-SALVO' });
        const token = generateAuthToken(captain, 'captain');

        const res = await request(app)
            .patch('/captains/document-info')
            .set('Authorization', `Bearer ${token}`)
            .send({ pix: { keyType: 'email', key: 'motorista@example.com' } });

        expect(res.statusCode).toBe(200);
        const persisted = await captainModel.findById(captain._id);
        expect(persisted.pix.key).toBe('motorista@example.com');
        expect(persisted.cnh.number).toBe('JA-SALVO');
    });

    it('corpo vazio retorna 400', async () => {
        const captain = await createCaptain();
        const token = generateAuthToken(captain, 'captain');

        const res = await request(app)
            .patch('/captains/document-info')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(res.statusCode).toBe(400);
    });
});

describe('Aprovação/rejeição pelo admin — cache e notificação', () => {
    const waitForNotification = async (captainId, attempts = 30, delayMs = 100) => {
        for (let i = 0; i < attempts; i++) {
            const found = await Notification.findOne({ captainId, type: 'DOCUMENT' });
            if (found) return found;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return null;
    };

    it('aprovar cadastro invalida o cache de perfil e notifica o motorista', async () => {
        const captain = await createCaptain({ approvalStatus: 'em_analise' });
        // Popula o cache de 10 min, como um GET /captains/profile real faria.
        await captainService.getCaptainProfile(captain._id);

        await adminService.updateCaptainApproval(captain._id.toString(), 'aprovado', 'ok', fakeAdmin, '127.0.0.1');

        // Cache invalidado: a próxima leitura reflete o novo status na hora, não em até 10min.
        const fresh = await captainService.getCaptainProfile(captain._id);
        expect(fresh.approvalStatus).toBe('aprovado');

        const notification = await waitForNotification(captain._id);
        expect(notification).toBeTruthy();
    });

    it('rejeitar um documento específico notifica o motorista com o motivo', async () => {
        const captain = await createCaptain();
        await captainModel.findByIdAndUpdate(captain._id, { 'documents.cnhFront.url': 'https://exemplo.com/cnh.jpg' });

        await adminService.updateCaptainDocument(captain._id.toString(), 'cnhFront', false, 'Foto ilegível', fakeAdmin, '127.0.0.1');

        const notification = await waitForNotification(captain._id);
        expect(notification).toBeTruthy();
        expect(notification.message).toMatch(/ilegível/i);
    });
});
