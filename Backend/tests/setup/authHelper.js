const authService = require('../../services/auth.service');

module.exports.generateAuthToken = (user, type = 'user') => {
    return authService.generateAccessToken(
        user._id,
        type,
        type === 'admin' ? { role: user.role } : {}
    );
};
