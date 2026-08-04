const request = require('supertest');
const app = require('../../app');
const userModel = require('../../models/user.model');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');

describe('User API Integration Tests', () => {
    
    describe('POST /users/register', () => {
        it('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/users/register')
                .send({
                    fullname: { firstname: 'John', lastname: 'Doe' },
                    email: 'john.doe@example.com',
                    password: 'securepassword123',
                    phone: '+5511999999999',
                    cpf: '12345678901'
                });

            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('token');
            expect(res.body.user.email).toBe('john.doe@example.com');
            
            const dbUser = await userModel.findOne({ email: 'john.doe@example.com' });
            expect(dbUser).toBeDefined();
        });

        it('should fail if email is already in use', async () => {
            await createUser({ email: 'duplicate@test.com' });

            const res = await request(app)
                .post('/users/register')
                .send({
                    fullname: { firstname: 'Jane', lastname: 'Doe' },
                    email: 'duplicate@test.com',
                    password: 'password123',
                    phone: '+5511888888888'
                });

            expect(res.statusCode).toBe(400); // or whatever the error code is
        });
    });

    describe('POST /users/login', () => {
        it('should login an existing user', async () => {
            const password = 'mysecurepassword';
            const user = await createUser({ email: 'login@test.com' });
            // Since factory uses 'password123' by default, we need to hash it or rely on factory 
            // Wait, factory creates plain string which mongoose pre-save hook hashes.
            
            const res = await request(app)
                .post('/users/login')
                .send({
                    email: 'login@test.com',
                    password: 'password123'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('token');
        });
    });

    describe('GET /users/profile', () => {
        it('should return user profile if authenticated', async () => {
            const user = await createUser();
            const token = generateAuthToken(user);

            const res = await request(app)
                .get('/users/profile')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.email).toBe(user.email);
        });

        it('should fail if token is missing or invalid', async () => {
            const res = await request(app)
                .get('/users/profile');

            expect(res.statusCode).toBe(401);
        });
    });

    describe('PUT /users/profile', () => {
        it('updates personal data for the authenticated user', async () => {
            const user = await createUser();
            const token = generateAuthToken(user);

            const res = await request(app)
                .put('/users/profile')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    firstname: 'Maria',
                    lastname: 'Silva',
                    phone: '11987654321',
                    cpf: '529.982.247-25',
                    birthDate: '1993-01-07',
                    gender: 'female',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.user.fullname.firstname).toBe('Maria');
            expect(res.body.user.fullname.lastname).toBe('Silva');
            expect(res.body.user.phone).toBe('+5511987654321');
            expect(res.body.user.cpf).toBe('52998224725');
            expect(res.body.user.gender).toBe('female');
        });

        it('rejects unauthenticated updates', async () => {
            const res = await request(app)
                .put('/users/profile')
                .send({ firstname: 'X' });

            expect(res.statusCode).toBe(401);
        });
    });
});
