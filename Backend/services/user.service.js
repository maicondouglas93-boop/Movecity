const userModel = require('../models/user.model');
const { getCache, setCache } = require('../cache/cache');

module.exports.createUser = async ({
    firstname, lastname, email, password
}) => {
    if (!firstname || !email || !password) {
        throw new Error('All fields are required');
    }
    const user = userModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password
    })

    return user;
}

module.exports.getUserProfile = async (id) => {
    const cacheKey = `profile:user:${id}`;
    const cachedUser = getCache(cacheKey);
    
    if (cachedUser) {
        return cachedUser;
    }
    
    const user = await userModel.findById(id);
    if (user) {
        setCache(cacheKey, user, 600); // 10 minutos
    }
    
    return user;
}