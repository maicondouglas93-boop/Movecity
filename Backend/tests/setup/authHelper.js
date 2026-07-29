const jwt = require('jsonwebtoken');

module.exports.generateAuthToken = (user, type = 'user') => {
    // A chave do JWT deve corresponder à chave no .env ou um default que o código usa
    const secret = process.env.JWT_SECRET || 'testsecret';
    // Baseado na model do user/captain do projeto:
    // O auth.middleware.js usa jwt.verify() para obter o ID ou dados do usuário.
    // Vamos criar o token da mesma forma que os models geram.
    
    // No projeto: user.generateAuthToken() retorna jwt.sign({ _id: this._id }, process.env.JWT_SECRET, { expiresIn: '24h' })
    return jwt.sign({ _id: user._id }, secret, { expiresIn: '24h' });
};
