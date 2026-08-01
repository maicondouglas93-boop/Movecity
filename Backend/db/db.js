const mongoose = require('mongoose');
const dns = require('dns');
// mongodb-memory-server é devDependency (não instalada em produção) — por isso o
// require fica dentro do fallback de dev/teste que realmente o usa, nunca no topo
// do arquivo, para não derrubar o processo em produção.

async function seedTestData() {
    try {
        const userModel = require('../models/user.model');
        const captainModel = require('../models/captain.model');
        const rideModel = require('../models/ride.model');
        const couponModel = require('../models/coupon.model');
        const reviewModel = require('../models/review.model');
        const notificationModel = require('../models/notification.model');
        const globalSettingModel = require('../models/globalSetting.model');

        const hashedPassword = await userModel.hashPassword('password123');

        const existingUsers = await userModel.countDocuments();
        if (existingUsers === 0) {
            const user1 = await userModel.create({
                fullname: { firstname: 'Carlos', lastname: 'Silva' },
                email: 'carlos.silva@email.com',
                password: hashedPassword,
                phone: '(11) 98765-4321',
                rating: 4.9,
                isBlocked: false
            });

            const user2 = await userModel.create({
                fullname: { firstname: 'Ana', lastname: 'Oliveira' },
                email: 'ana.oliveira@email.com',
                password: hashedPassword,
                phone: '(21) 99887-6655',
                rating: 5.0,
                isBlocked: false
            });

            const captain1 = await captainModel.create({
                fullname: { firstname: 'Roberto', lastname: 'Santos' },
                email: 'roberto.captain@email.com',
                password: hashedPassword,
                phone: '(11) 91234-5678',
                status: 'active',
                approvalStatus: 'approved',
                isBlocked: false,
                rating: 4.8,
                earnings: 1450.50,
                vehicle: { color: 'Preto', plate: 'ABC-1234', capacity: 4, vehicleType: 'car' },
                documents: { cnh: 'cnh_roberto.pdf', crlv: 'crlv_roberto.pdf', photo: 'photo_roberto.jpg' },
                location: { ltd: -23.55052, lng: -46.633308 }
            });

            const captain2 = await captainModel.create({
                fullname: { firstname: 'Fernanda', lastname: 'Lima' },
                email: 'fernanda.captain@email.com',
                password: hashedPassword,
                phone: '(11) 97777-8888',
                status: 'active',
                approvalStatus: 'approved',
                isBlocked: false,
                rating: 4.9,
                earnings: 820.00,
                vehicle: { color: 'Vermelha', plate: 'MTO-9988', capacity: 1, vehicleType: 'moto' },
                documents: { cnh: 'cnh_fernanda.pdf', crlv: 'crlv_fernanda.pdf', photo: 'photo_fernanda.jpg' },
                location: { ltd: -23.5615, lng: -46.6559 }
            });

            const captain3 = await captainModel.create({
                fullname: { firstname: 'Lucas', lastname: 'Mendes' },
                email: 'lucas.captain@email.com',
                password: hashedPassword,
                phone: '(11) 96666-5555',
                status: 'active',
                approvalStatus: 'approved',
                isBlocked: false,
                rating: 5.0,
                earnings: 2100.00,
                vehicle: { color: 'Prata', plate: 'AUT-7766', capacity: 3, vehicleType: 'auto' },
                documents: { cnh: 'cnh_lucas.pdf', crlv: 'crlv_lucas.pdf', photo: 'photo_lucas.jpg' },
                location: { ltd: -23.5432, lng: -46.6421 }
            });

            const ride1 = await rideModel.create({
                user: user1._id,
                captain: captain1._id,
                pickup: 'Av. Paulista, 1000 - Bela Vista',
                destination: 'Aeroporto de Congonhas',
                fare: 45.90,
                vehicleType: 'car',
                status: 'completed',
                paymentStatus: 'completed',
                paymentMethod: 'card',
                duration: 1200,
                distance: 9500,
                otp: '1234'
            });

            await couponModel.create({
                code: 'PRIMEIRA20',
                discountPercent: 20,
                maxDiscount: 15,
                expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                usageLimit: 500,
                isActive: true
            });

            await couponModel.create({
                code: 'UBERFREE',
                discountPercent: 50,
                maxDiscount: 30,
                expirationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                usageLimit: 100,
                isActive: true
            });

            await reviewModel.create({
                ride: ride1._id,
                user: user1._id,
                captain: captain1._id,
                rating: 5,
                comment: 'Excelente motorista, carro muito limpo e viagem tranquila!',
                type: 'passenger_to_driver',
                issueCategory: 'none'
            });

            await reviewModel.create({
                ride: ride1._id,
                user: user2._id,
                captain: captain2._id,
                rating: 2,
                comment: 'Motorista atrasou 15 minutos para chegar ao local de embarque.',
                type: 'passenger_to_driver',
                issueCategory: 'delay'
            });

            await rideModel.create({
                user: user2._id,
                captain: captain1._id,
                pickup: 'Rua Augusta, 500',
                destination: 'Shopping Eldorado',
                fare: 28.50,
                vehicleType: 'car',
                status: 'ongoing',
                paymentStatus: 'pending',
                paymentMethod: 'upi',
                duration: 600,
                distance: 4200,
                otp: '5678'
            });

            await rideModel.create({
                user: user1._id,
                captain: captain2._id,
                pickup: 'Av. Brigadeiro Faria Lima, 2000',
                destination: 'Parque Ibirapuera',
                fare: 18.00,
                vehicleType: 'moto',
                status: 'finished',
                paymentStatus: 'completed',
                paymentMethod: 'cash',
                duration: 480,
                distance: 3100,
                otp: '9988'
            });

            await rideModel.create({
                user: user2._id,
                captain: captain1._id,
                pickup: 'Estação da Luz',
                destination: 'Mercado Municipal de SP',
                fare: 15.00,
                vehicleType: 'car',
                status: 'cancelled',
                paymentStatus: 'refunded',
                paymentMethod: 'card',
                duration: 180,
                distance: 1200,
                otp: '4433'
            });

            await globalSettingModel.create({
                platformCommission: 20,
                minFare: 5.0,
                pricePerKm: 2.0,
                pricePerMinute: 0.5,
                vehicleTypes: ['car', 'moto', 'auto'],
                promotionalHours: 'Nenhum horário promocional ativo'
            });

            await notificationModel.create({
                title: 'Alerta de Chuva - Dinâmica Ativa',
                message: 'Previsão de chuva forte na próxima hora. Tarifas dinâmicas ativadas.',
                targetAudience: 'all',
                status: 'sent',
                sentAt: new Date()
            });

            await notificationModel.create({
                title: 'Bônus de Fim de Semana',
                message: 'Complete 10 corridas no fim de semana e ganhe R$ 50 de bônus.',
                targetAudience: 'drivers',
                status: 'sent',
                sentAt: new Date()
            });

            await notificationModel.create({
                title: 'Cupom de 50% OFF',
                message: 'Use o cupom UBERFREE para ganhar 50% de desconto na próxima viagem!',
                targetAudience: 'passengers',
                status: 'sent',
                sentAt: new Date()
            });

            console.log('Test data seeded successfully into Database');
        }
    } catch (err) {
        console.error('Error seeding test data:', err);
    }
}

async function connectToDb() {
    try {
        dns.setServers(['8.8.8.8', '8.8.4.4']);
    } catch (err) {
        console.warn('DNS setServers failed:', err.message);
    }

    mongoose.connection.on('error', err => {
        console.error('Mongoose connection error:', err);
    });

    mongoose.connection.once('open', () => {
        console.log("MongoDB conectado");
    });

    try {
        if (process.env.DB_CONNECT && !process.env.DB_CONNECT.includes('127.0.0.1')) {
            await mongoose.connect(process.env.DB_CONNECT);
            console.log('Connected to Remote MongoDB');
        } else {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('A conexão com o banco de dados falhou e fallbacks não são permitidos em produção.');
            }
            throw new Error('Local MongoDB requested, starting MongoMemoryServer fallback');
        }
    } catch (err) {
        if (process.env.NODE_ENV === 'production') {
            console.error('Fatal Error: Unable to connect to MongoDB in production.', err.message);
            process.exit(1);
        }
        console.warn('Starting in-memory MongoDB fallback...');
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);
        console.log('Connected to In-Memory MongoDB at', mongoUri);
    }

    // Nunca popular o banco de produção com dados fictícios (motoristas, corridas e
    // avaliações inventados) — só roda em dev/teste, onde ajuda a ter dado pra trabalhar.
    if (process.env.NODE_ENV !== 'production') {
        await seedTestData();
    }
}

module.exports = connectToDb;