const rateLimit = require('express-rate-limit');

module.exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // max 5 tentativas
    message: { message: "Muitas tentativas de login. Tente novamente em 15 minutos." }
});
