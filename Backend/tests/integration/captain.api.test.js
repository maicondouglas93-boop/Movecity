const request = require('supertest');
const app = require('../../app');
const captainModel = require('../../models/captain.model');
const { generateAuthToken } = require('../setup/authHelper');
const { createCaptain } = require('../factories/captain.factory');

describe('Captain API Integration Tests', () => {
    
    describe('POST /captains/register', () => {
        it('should register a new captain successfully', async () => {
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
});
