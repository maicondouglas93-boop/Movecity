const request = require('supertest');
const app = require('../../app');
const captainModel = require('../../models/captain.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const rideModel = require('../../models/ride.model');
const { generateAuthToken } = require('../setup/authHelper');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const { createRide } = require('../factories/ride.factory');

describe('Captain API Integration Tests', () => {

    describe('POST /captains/register', () => {
        it('should register a new captain successfully', async () => {
            // Cadastro exige que o vehicleType corresponda a uma categoria ativa real
            // (categorias agora são 100% dinâmicas, sem enum fixo — ver A2 na auditoria).
            await vehicleCategoryModel.create({ name: 'car', displayName: 'Carro', isActive: true });

            const res = await request(app)
                .post('/captains/register')
                .send({
                    fullname: { firstname: 'Bruce', lastname: 'Wayne' },
                    email: 'bruce.wayne@example.com',
                    password: 'securepassword123',
                    phone: '+5511999999999',
                    cpf: '12345678901',
                    birthDate: '1990-01-01',
                    cnh: {
                        number: '123456789',
                        category: 'B',
                        expiration: '2030-01-01'
                    },
                    pix: {
                        keyType: 'cpf',
                        key: '12345678901'
                    },
                    vehicle: {
                        marca: 'Fiat',
                        modelo: 'Uno',
                        ano: 2020,
                        color: 'black',
                        plate: 'BAT1234',
                        capacity: 4,
                        vehicleType: 'car'
                    }
                });

            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('token');
            expect(res.body.captain.email).toBe('bruce.wayne@example.com');
            
            const dbCaptain = await captainModel.findOne({ email: 'bruce.wayne@example.com' });
            expect(dbCaptain).toBeDefined();
        });
    });

    describe('POST /captains/login', () => {
        it('should login an existing captain', async () => {
            const captain = await createCaptain({ email: 'login_cap@test.com' });
            
            const res = await request(app)
                .post('/captains/login')
                .send({
                    email: 'login_cap@test.com',
                    password: 'password123'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('token');
        });
    });

    describe('GET /captains/profile', () => {
        it('should return captain profile if authenticated', async () => {
            const captain = await createCaptain();
            const token = generateAuthToken(captain, 'captain');

            const res = await request(app)
                .get('/captains/profile')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.captain.email).toBe(captain.email);
        });
    });

    describe('GET /captains/earnings (auditoria de UX, 2026-08-02, Etapa 8)', () => {
        it('recorte "day" só soma corridas finalizadas hoje, com detalhe por corrida', async () => {
            const captain = await createCaptain();
            const token = generateAuthToken(captain, 'captain');
            const user = await createUser();

            const today = await createRide({
                user: user._id, captain: captain._id, status: 'finished',
                fare: 50, finalPrice: 50, commissionAmount: 10
            });
            const eightDaysAgo = await createRide({
                user: user._id, captain: captain._id, status: 'finished',
                fare: 30, finalPrice: 30, commissionAmount: 6
            });
            // updatedAt é auto-gerenciado (timestamps:true) — sobrescreve direto no banco
            // pra simular uma corrida de 8 dias atrás, fora da janela de "day" e "week".
            await rideModel.updateOne(
                { _id: eightDaysAgo._id },
                { updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
                { timestamps: false }
            );

            const res = await request(app)
                .get('/captains/earnings?range=day')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.totalRides).toBe(1);
            expect(res.body.totalEarnings).toBe(40); // 50 - 10
            expect(res.body.rides).toHaveLength(1);
            expect(res.body.rides[0].netEarnings).toBe(40);
        });

        it('recorte "week" inclui corridas de até 7 dias atrás, mas não de 8', async () => {
            const captain = await createCaptain();
            const token = generateAuthToken(captain, 'captain');
            const user = await createUser();

            const threeDaysAgo = await createRide({
                user: user._id, captain: captain._id, status: 'finished',
                fare: 40, finalPrice: 40, commissionAmount: 8
            });
            await rideModel.updateOne(
                { _id: threeDaysAgo._id },
                { updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
                { timestamps: false }
            );
            const nineDaysAgo = await createRide({
                user: user._id, captain: captain._id, status: 'finished',
                fare: 20, finalPrice: 20, commissionAmount: 4
            });
            await rideModel.updateOne(
                { _id: nineDaysAgo._id },
                { updatedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) },
                { timestamps: false }
            );

            const res = await request(app)
                .get('/captains/earnings?range=week')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.totalRides).toBe(1);
            expect(res.body.totalEarnings).toBe(32); // 40 - 8
        });

        it('range inválido cai no padrão "day" em vez de quebrar', async () => {
            const captain = await createCaptain();
            const token = generateAuthToken(captain, 'captain');

            const res = await request(app)
                .get('/captains/earnings?range=year')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.range).toBe('day');
        });
    });
});
