const userModel = require('../models/user.model');
const userService = require('../services/user.service');
const { validationResult } = require('express-validator');
const blackListTokenModel = require('../models/blacklistToken.model');
const authService = require('../services/auth.service');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('node:crypto');
const {
    normalizeEmail,
    validateGoogleIdentityClaims,
    isLegacyGoogleEmailLinkEnabled,
    confirmExistingGoogleAccountLink,
} = require('../utils/googleIdentity');

const ACTOR = 'user';

function googleErrorResponse(res, error) {
    return res.status(error.statusCode || 401).json({
        code: error.code || 'GOOGLE_AUTH_FAILED',
        message: error.message || 'Não foi possível autenticar com o Google.',
    });
}

function legacyGoogleEmailLinkEnabled() {
    return isLegacyGoogleEmailLinkEnabled({
        allowLegacyEmailLink: process.env.GOOGLE_ALLOW_LEGACY_EMAIL_LINK,
        legacyLinkUntil: process.env.GOOGLE_LEGACY_LINK_UNTIL,
    });
}

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

        const { fullname, password, cpf, phone } = req.body;
        const email = normalizeEmail(req.body.email);

        const isUserAlready = await userService.findUserByNormalizedEmail(email);
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
        if (err.code === 11000) {
            return res.status(409).json({ message: 'O usuário já existe' });
        }
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

        const { password } = req.body;
        const email = normalizeEmail(req.body.email);

        const user = await userService.findUserByNormalizedEmail(email, '+password');
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

        await authService.revokeAccessSession({
            userId: req.user?._id,
            userType: 'user',
            jti: req.auth?.jti,
            reason: 'logout',
        });

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
        if (String(process.env.GOOGLE_LOGIN_ENABLED).toLowerCase() === 'false') {
            return res.status(503).json({
                code: 'GOOGLE_LOGIN_DISABLED',
                message: 'Login com Google temporariamente indisponível.',
            });
        }

        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ message: 'ID token não fornecido' });
        }

        let identity;
        try {
            const decodedToken = await getAuth().verifyIdToken(idToken, true);
            identity = validateGoogleIdentityClaims(decodedToken);
        } catch (error) {
            if (typeof error.code === 'string' && error.code.startsWith('GOOGLE_')) {
                return googleErrorResponse(res, error);
            }
            console.error('Error verifying Firebase ID token:', error.code || error.message);
            return res.status(401).json({ code: 'GOOGLE_ID_TOKEN_INVALID', message: 'ID token inválido' });
        }

        const { uid, email, name, picture } = identity;

        // O UID verificado é a identidade primária. E-mail é usado apenas para localizar
        // uma conta local ainda não vinculada, que exige confirmação explícita.
        let user = await userModel.findOne({ firebaseUid: uid }).select('+firebaseUid +password');
        if (user && normalizeEmail(user.email) !== email) {
            return res.status(409).json({
                code: 'GOOGLE_IDENTITY_CONFLICT',
                message: 'O e-mail da identidade Google diverge da conta vinculada. Contate o suporte.',
            });
        }

        if (!user) {
            user = await userService.findUserByNormalizedEmail(email, '+firebaseUid +password');
            if (user?.firebaseUid && user.firebaseUid !== uid) {
                return res.status(409).json({
                    code: 'GOOGLE_IDENTITY_CONFLICT',
                    message: 'Este e-mail já está vinculado a outra identidade Google.',
                });
            }
        }

        if (user?.isBlocked) {
            await authService.revokeAllForUser({ userId: user._id, userType: 'user', reason: 'blocked' });
            return res.status(403).json({ message: 'Esta conta está desativada. Entre em contato com o suporte.' });
        }

        if (!user) {
            const nameParts = name ? name.trim().split(/\s+/) : ['Google', 'User'];
            const firstname = nameParts[0] || 'Google';
            const lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User';

            // Senha aleatória criptografada para usuários OAuth
            const randomPassword = crypto.randomBytes(32).toString('hex');
            const hashedPassword = await userModel.hashPassword(randomPassword);

            user = await userService.createUser({
                firstname,
                lastname,
                email,
                password: hashedPassword,
                profilePicture: picture || '',
                firebaseUid: uid,
            });
        } else if (!user.firebaseUid) {
            const linkMethod = await confirmExistingGoogleAccountLink({
                user,
                password: req.body.password,
                allowLegacyLink: legacyGoogleEmailLinkEnabled(),
            });
            if (linkMethod === 'legacy-window') {
                console.warn(JSON.stringify({
                    tag: 'AUTH_GOOGLE_LEGACY_EMAIL_LINK',
                    at: new Date().toISOString(),
                }));
            }
            user.firebaseUid = uid;
            user.email = email;
            if (picture) user.profilePicture = picture;
            await user.save();
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
        if (err.code === 'GOOGLE_LINK_PASSWORD_REQUIRED') {
            return googleErrorResponse(res, err);
        }
        if (typeof err.code === 'string' && err.code.startsWith('GOOGLE_')) {
            return googleErrorResponse(res, err);
        }
        if (err.code === 11000) {
            return res.status(409).json({
                code: 'GOOGLE_IDENTITY_CONFLICT',
                message: 'Não foi possível vincular a identidade sem conflito de conta.',
            });
        }
        console.error('Error in googleLogin:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};
