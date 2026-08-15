const userModel = require('../models/user.model');
const userService = require('../services/user.service');
const { validationResult } = require('express-validator');
const blackListTokenModel = require('../models/blacklistToken.model');
const authService = require('../services/auth.service');
const { getAuth } = require('firebase-admin/auth');

const ACTOR = 'user';

function clearLegacyCookies(res) {
    const { maxAge, ...accessOptions } = authService.accessCookieOptions();
    res.clearCookie('token', accessOptions);
    res.clearCookie('refreshToken', { ...accessOptions, path: '/' });
}

// O navegador recebe o refresh exclusivamente no cookie HttpOnly específico do ator.
// Somente transportes explicitamente seguros/testes podem receber o segredo no JSON.
async function respondWithSession(req, res, { userDoc, userType, extraClaims = {}, ip, statusCode = 200, payload = {} }) {
    const { accessToken, refreshToken } = await authService.issueTokenPair({
        userId: userDoc._id,
        userType,
        extraClaims,
        ip
    });

    res.cookie(authService.ACCESS_COOKIE_BY_ACTOR[userType], accessToken, authService.accessCookieOptions());
    res.cookie(authService.REFRESH_COOKIE_BY_ACTOR[userType], refreshToken, authService.refreshCookieOptions(userType));
    clearLegacyCookies(res);

    const refreshPayload = authService.shouldExposeRefreshToken(req, userType) ? { refreshToken } : {};
    return res.status(statusCode).json({ token: accessToken, ...refreshPayload, ...payload });
}

module.exports.respondWithSession = respondWithSession;

module.exports.registerUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { fullname, email, password, cpf, phone } = req.body;

        const isUserAlready = await userModel.findOne({ email });
        if (isUserAlready) {
            return res.status(400).json({ message: 'O usuário já existe' });
        }

        const hashedPassword = await userModel.hashPassword(password);

        const user = await userService.createUser({
            firstname: fullname.firstname,
            lastname: fullname.lastname,
            email,
            password: hashedPassword,
            cpf,
            phone
        });

        return await respondWithSession(req, res, {
            userDoc: user,
            userType: 'user',
            ip: req.ip,
            statusCode: 201,
            payload: { user }
        });
    } catch (err) {
        console.error('Error in registerUser:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.loginUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        const user = await userModel.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ message: 'E-mail ou senha inválidos' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'E-mail ou senha inválidos' });
        }

        if (user.isBlocked) {
            await authService.revokeAllForUser({ userId: user._id, userType: 'user', reason: 'blocked' });
            return res.status(403).json({ message: 'Esta conta está desativada. Entre em contato com o suporte.' });
        }

        return await respondWithSession(req, res, {
            userDoc: user,
            userType: 'user',
            ip: req.ip,
            payload: { user }
        });
    } catch (err) {
        console.error('Error in loginUser:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.getUserProfile = async (req, res, next) => {
    try {
        return res.status(200).json(req.user);
    } catch (err) {
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.updateUserProfile = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0]?.msg || 'Dados inválidos', errors: errors.array() });
        }

        const { firstname, lastname, phone, cpf, birthDate, gender } = req.body;
        const user = await userService.updateUserProfile(req.user._id, {
            firstname,
            lastname,
            phone,
            cpf,
            birthDate,
            gender,
        });

        return res.status(200).json({ user });
    } catch (err) {
        if (err.code === 'VALIDATION') {
            return res.status(400).json({ message: err.message });
        }
        if (err.code === 'CONFLICT' || err.code === 11000) {
            return res.status(409).json({ message: err.message || 'Dados em conflito com outra conta.' });
        }
        if (err.message === 'User not found') {
            return res.status(404).json({ message: 'Usuário não encontrado' });
        }
        console.error('Error in updateUserProfile:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.logoutUser = async (req, res, next) => {
    try {
        const { maxAge, ...accessClearOptions } = authService.accessCookieOptions();
        res.clearCookie(authService.ACCESS_COOKIE_BY_ACTOR[ACTOR], accessClearOptions);
        res.clearCookie(authService.REFRESH_COOKIE_BY_ACTOR[ACTOR], authService.clearCookieOptions(ACTOR));
        clearLegacyCookies(res);

        // O middleware conserva exatamente o token que autenticou a requisição. Bearer
        // tem prioridade sobre cookie para não deixar um cookie antigo mascarar uma
        // sessão válida do app nativo.
        const token = req.authToken;

        if (token) {
            // create pode falhar por chave duplicada se o mesmo token for deslogado
            // duas vezes — não é motivo pra devolver 500 num logout.
            await blackListTokenModel.create({ token }).catch(() => {});
        }

        // Refresh token só é aceito no corpo ou em cookie HttpOnly. Query string foi
        // removida porque URLs vazam em histórico, logs, observabilidade e Referer.
        const refreshToken = authService.resolveRefreshToken(req, ACTOR);
        if (refreshToken) {
            await authService.revokeRefreshToken({ refreshToken, reason: 'logout' });
        } else if (req.user?._id) {
            // Sem o refresh token em mãos, encerra todas as sessões deste usuário —
            // melhor um logout amplo demais do que uma sessão sobrevivendo ao "Sair".
            await authService.revokeAllForUser({ userId: req.user._id, userType: 'user', reason: 'logout' });
        }

        return res.status(200).json({ message: 'Deslogado com sucesso' });
    } catch (err) {
        console.error('Error in logoutUser:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

// Auditoria de sessão (2026-08-02): endpoint novo — antes não existia renovação nenhuma
// pro passageiro, então a sessão simplesmente morria quando o token de 24h expirava.
module.exports.refreshUserSession = async (req, res) => {
    try {
        const presentedToken = authService.resolveRefreshToken(req, ACTOR);
        const { userId, userType, refreshToken } = await authService.rotateRefreshToken({
            refreshToken: presentedToken,
            expectedUserType: 'user',
            ip: req.ip
        });
        if (userType !== 'user') {
            return res.status(401).json({ message: 'Sessão emitida para outro tipo de conta' });
        }

        const user = await userService.getUserProfile(userId);
        if (!user) {
            return res.status(401).json({ message: 'Sessão inválida' });
        }
        if (user.isBlocked) {
            await authService.revokeAllForUser({ userId, userType: 'user', reason: 'blocked' });
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        const accessToken = authService.generateAccessToken(userId, 'user');
        res.cookie(authService.ACCESS_COOKIE_BY_ACTOR[ACTOR], accessToken, authService.accessCookieOptions());
        if (refreshToken) {
            res.cookie(authService.REFRESH_COOKIE_BY_ACTOR[ACTOR], refreshToken, authService.refreshCookieOptions(ACTOR));
        }
        clearLegacyCookies(res);

        const refreshPayload = authService.shouldExposeRefreshToken(req, ACTOR) && refreshToken
            ? { refreshToken }
            : {};
        return res.status(200).json({ token: accessToken, ...refreshPayload, user });
    } catch (err) {
        return res.status(401).json({ message: err.message || 'Sessão inválida' });
    }
};

module.exports.googleLogin = async (req, res, next) => {
    try {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ message: 'ID token não fornecido' });
        }

        let decodedToken;
        try {
            decodedToken = await getAuth().verifyIdToken(idToken);
        } catch (error) {
            console.error('Error verifying Firebase ID token:', error);
            return res.status(401).json({ message: 'ID token inválido' });
        }

        const { email, name, picture } = decodedToken;

        let user = await userModel.findOne({ email });

        if (user?.isBlocked) {
            await authService.revokeAllForUser({ userId: user._id, userType: 'user', reason: 'blocked' });
            return res.status(403).json({ message: 'Esta conta está desativada. Entre em contato com o suporte.' });
        }

        if (!user) {
            const nameParts = name ? name.trim().split(/\s+/) : ['Google', 'User'];
            const firstname = nameParts[0] || 'Google';
            const lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User';

            // Senha aleatória criptografada para usuários OAuth
            const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
            const hashedPassword = await userModel.hashPassword(randomPassword);

            user = await userService.createUser({
                firstname,
                lastname,
                email,
                password: hashedPassword,
                profilePicture: picture || ''
            });
        } else if (picture && user.profilePicture !== picture) {
            user.profilePicture = picture;
            await user.save();
        }

        return await respondWithSession(req, res, {
            userDoc: user,
            userType: 'user',
            ip: req.ip,
            payload: { user }
        });
    } catch (err) {
        console.error('Error in googleLogin:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};
