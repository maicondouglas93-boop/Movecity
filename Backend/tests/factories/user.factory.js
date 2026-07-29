const mongoose = require('mongoose');
const userModel = require('../../models/user.model');

module.exports.createUser = async (overrides = {}) => {
    const defaultData = {
        fullname: { firstname: 'Test', lastname: 'User' },
        email: `user_${Date.now()}@test.com`,
        phone: '+55119' + Math.floor(10000000 + Math.random() * 90000000).toString(),
        password: await userModel.hashPassword('password123'),
        cpf: Math.floor(10000000000 + Math.random() * 90000000000).toString().substring(0, 11)
    };

    return await userModel.create({ ...defaultData, ...overrides });
};
