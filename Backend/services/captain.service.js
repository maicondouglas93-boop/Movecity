const captainModel = require('../models/captain.model');
const { getCache, setCache } = require('../cache/cache');

module.exports.createCaptain = async ({
    firstname, lastname, email, password, cpf, birthDate, phone, 
    color, plate, capacity, vehicleType, marca, modelo, ano,
    cnhNumber, cnhCategory, cnhExpiration, cnhUf, cnhEar,
    pixKeyType, pixKey
}) => {
    if (!firstname || !email || !password || !color || !plate || !capacity || !vehicleType || !cpf || !phone || !cnhNumber || !pixKey) {
        throw new Error('Required fields are missing');
    }
    const captain = captainModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        cpf,
        birthDate,
        phone,
        cnh: {
            number: cnhNumber,
            category: cnhCategory,
            expiration: cnhExpiration,
            uf: cnhUf,
            ear: cnhEar
        },
        pix: {
            keyType: pixKeyType,
            key: pixKey
        },
        vehicle: {
            marca,
            modelo,
            ano,
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