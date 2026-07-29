const mongoose = require('mongoose');
const captainModel = require('../../models/captain.model');

module.exports.createCaptain = async (overrides = {}) => {
    const defaultData = {
        fullname: { firstname: 'Test', lastname: 'Captain' },
        email: `captain_${Date.now()}@test.com`,
        phone: '+55119' + Math.floor(10000000 + Math.random() * 90000000).toString(),
        password: await captainModel.hashPassword('password123'),
        cpf: Math.floor(10000000000 + Math.random() * 90000000000).toString().substring(0, 11),
        vehicle: { color: 'black', plate: 'ABC' + Math.floor(1000 + Math.random() * 9000), capacity: 4, vehicleType: 'car' },
        approvalStatus: 'aprovado',
        status: 'active',
        canReceiveRides: true
    };

    return await captainModel.create({ ...defaultData, ...overrides });
};
