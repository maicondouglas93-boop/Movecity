const { validationResult } = require('express-validator');
const accountDeletionRequestModel = require('../models/accountDeletionRequest.model');
const accountDeletionService = require('../services/accountDeletion.service');
const authService = require('../services/auth.service');

function validationMessage(req) {
    const errors = validationResult(req);
    return errors.isEmpty() ? null : errors.array()[0]?.msg;
}

function clearSessionCookies(res, accountType) {
    const { maxAge, ...accessOptions } = authService.accessCookieOptions();
    res.clearCookie(authService.ACCESS_COOKIE_BY_ACTOR[accountType], accessOptions);
    res.clearCookie(authService.REFRESH_COOKIE_BY_ACTOR[accountType], authService.clearCookieOptions(accountType));
    res.clearCookie('token', accessOptions);
    res.clearCookie('refreshToken', { ...accessOptions, path: '/' });
}

function handleError(res, error) {
    if (error.statusCode) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error('[AccountDeletion]', error);
    return res.status(500).json({ message: 'Não foi possível processar a solicitação.' });
}

module.exports.requestPublic = async (req, res) => {
    const message = validationMessage(req);
    if (message) return res.status(400).json({ message });

    try {
        await accountDeletionService.requestPublic(req.body);
        return res.status(202).json({
            message: 'Se os dados corresponderem a uma conta, o suporte continuará a verificação da solicitação.',
        });
    } catch (error) {
        return handleError(res, error);
    }
};

async function requestAuthenticated(req, res, accountType) {
    const message = validationMessage(req);
    if (message) return res.status(400).json({ message });

    try {
        const account = accountType === 'captain' ? req.captain : req.user;
        const accessToken = req.authToken;
        const request = await accountDeletionService.requestAuthenticated({
            account,
            accountType,
            confirmation: req.body.confirmation,
            accessToken,
        });
        clearSessionCookies(res, accountType);
        return res.status(202).json({
            message: 'Conta desativada. Seus dados pessoais serão removidos ou anonimizados em até 30 dias.',
            processAfter: request.processAfter,
        });
    } catch (error) {
        return handleError(res, error);
    }
}

module.exports.requestUser = (req, res) => requestAuthenticated(req, res, 'user');
module.exports.requestCaptain = (req, res) => requestAuthenticated(req, res, 'captain');

module.exports.listAdmin = async (req, res) => {
    try {
        const status = req.query.status;
        const query = status ? { status } : {};
        const requests = await accountDeletionRequestModel.find(query).sort({ createdAt: -1 }).limit(200);
        return res.status(200).json({ requests });
    } catch (error) {
        return handleError(res, error);
    }
};

module.exports.approveAdmin = async (req, res) => {
    try {
        const request = await accountDeletionService.approvePublicRequest({
            requestId: req.params.id,
            adminId: req.admin._id,
        });
        return res.status(200).json({ request });
    } catch (error) {
        return handleError(res, error);
    }
};
