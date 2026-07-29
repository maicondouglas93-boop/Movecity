process.env.NODE_ENV = 'test';
require('dotenv').config();
const { connect, closeDatabase, clearDatabase } = require('./testDatabase');

// Global setup
beforeAll(async () => {
    // Disable external logging during tests to keep console clean, unless debugging
    // console.log = jest.fn();
    // console.info = jest.fn();
    
    // Configura Mocks Globais para garantir que APIs externas não sejam chamadas
    jest.mock('firebase-admin', () => ({
        initializeApp: jest.fn(),
        credential: {
            cert: jest.fn(),
        }
    }));
    jest.mock('firebase-admin/auth', () => ({
        getAuth: jest.fn(() => ({
            verifyIdToken: jest.fn().mockResolvedValue({ uid: 'firebase_mock_uid', email: 'mock@test.com' })
        }))
    }));
    jest.mock('../../services/maps.service'); // Deve ter um __mocks__ ou definiremos manualmente
    jest.mock('../../services/asaas.service', () => ({
        createCustomer: jest.fn().mockResolvedValue({ id: 'cus_mock123' }),
        createPixCharge: jest.fn().mockResolvedValue({ invoiceUrl: 'http://mock.pix', payload: 'mock_payload' }),
        createCreditCardCharge: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
        createTransfer: jest.fn().mockResolvedValue({ status: 'PENDING' }),
        checkPaymentStatus: jest.fn().mockResolvedValue({ status: 'RECEIVED' })
    }));
    
    await connect();
});

afterEach(async () => {
    await clearDatabase();
    jest.clearAllMocks();
});

afterAll(async () => {
    await closeDatabase();
});
