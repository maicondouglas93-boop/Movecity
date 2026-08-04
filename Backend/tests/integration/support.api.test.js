const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const supportTicketModel = require('../../models/supportTicket.model');

describe('Support API', () => {
    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = generateAuthToken(user);
    });

    describe('GET /support/contact', () => {
        it('returns contact channels without auth', async () => {
            const originalWa = process.env.SUPPORT_WHATSAPP;
            const originalEmail = process.env.SUPPORT_EMAIL;
            process.env.SUPPORT_WHATSAPP = '5511999999999';
            process.env.SUPPORT_EMAIL = 'suporte@movecity.test';

            try {
                const res = await request(app).get('/support/contact');
                expect(res.statusCode).toBe(200);
                expect(res.body.whatsapp).toBe('5511999999999');
                expect(res.body.whatsappUrl).toBe('https://wa.me/5511999999999');
                expect(res.body.email).toBe('suporte@movecity.test');
            } finally {
                if (originalWa === undefined) delete process.env.SUPPORT_WHATSAPP;
                else process.env.SUPPORT_WHATSAPP = originalWa;
                if (originalEmail === undefined) delete process.env.SUPPORT_EMAIL;
                else process.env.SUPPORT_EMAIL = originalEmail;
            }
        });
    });

    describe('POST /support/tickets', () => {
        it('creates a ticket for the authenticated passenger', async () => {
            const res = await request(app)
                .post('/support/tickets')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    category: 'lost_item',
                    message: 'Esqueci minha mochila preta no banco de trás após a corrida de ontem.',
                });

            expect(res.statusCode).toBe(201);
            expect(res.body.ticket).toBeTruthy();
            expect(res.body.ticket.user.toString()).toBe(user._id.toString());
            expect(res.body.ticket.status).toBe('open');
            expect(res.body.ticket.category).toBe('lost_item');

            const saved = await supportTicketModel.findById(res.body.ticket._id);
            expect(saved).toBeTruthy();
        });

        it('rejects short messages', async () => {
            const res = await request(app)
                .post('/support/tickets')
                .set('Authorization', `Bearer ${token}`)
                .send({ category: 'other', message: 'oi' });

            expect(res.statusCode).toBe(400);
        });
    });

    describe('GET /support/tickets', () => {
        it('lists only tickets of the authenticated user', async () => {
            await supportTicketModel.create({
                user: user._id,
                category: 'payment',
                subject: 'Cobrança',
                message: 'Fui cobrado duas vezes na mesma corrida.',
            });

            const other = await createUser();
            await supportTicketModel.create({
                user: other._id,
                category: 'other',
                subject: 'Outro',
                message: 'Chamado de outra pessoa, não deve aparecer.',
            });

            const res = await request(app)
                .get('/support/tickets')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.tickets).toHaveLength(1);
            expect(res.body.tickets[0].user.toString()).toBe(user._id.toString());
        });
    });
});
