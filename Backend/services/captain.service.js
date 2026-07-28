const captainModel = require('../models/captain.model');
const { getCache, setCache } = require('../cache/cache');

module.exports.createCaptain = async ({
    firstname, lastname, email, password, color, plate, capacity, vehicleType
}) => {
    if (!firstname || !email || !password || !color || !plate || !capacity || !vehicleType) {
        throw new Error('All fields are required');
    }
    const captain = captainModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        vehicle: {
            color,
            plate,
            capacity,
            vehicleType
        }
    })

    return captain;
}

module.exports.getCaptainProfile = async (id) => {
    const cacheKey = `profile:captain:${id}`;
    const cachedCaptain = getCache(cacheKey);
    
    if (cachedCaptain) {
        return cachedCaptain;
    }
    
    const captain = await captainModel.findById(id);
    if (captain) {
        setCache(cacheKey, captain, 600); // 10 minutos
    }
    
    return captain;
}