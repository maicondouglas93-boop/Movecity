const mongoose = require('mongoose');
const rideModel = require('../../models/ride.model');
const { createUser } = require('./user.factory');
const { createCaptain } = require('./captain.factory');

module.exports.createRide = async (overrides = {}) => {
    let { user, captain } = overrides;
    
    if (!user) user = (await createUser())._id;
    if (!captain) captain = (await createCaptain())._id;

    const defaultData = {
        user,
        captain,
        pickup: 'Avenida Paulista, São Paulo',
        destination: 'Avenida Faria Lima, São Paulo',
        fare: 35.50,
        status: 'accepted',
        paymentMethod: 'cash',
        vehicleType: 'car',
        otp: '1234'
    };

    return await rideModel.create({ ...defaultData, ...overrides });
};
