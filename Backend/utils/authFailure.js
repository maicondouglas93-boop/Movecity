// Apenas rejeições conhecidas de credenciais significam sessão inválida. Uma falha
// de Mongo/transação/configuração não pode ser convertida em 401 e apagar o login.
const INVALID_SESSION_CODES = new Set([
    'INVALID_TOKEN_ACTOR',
    'TOKEN_ACTOR_MISMATCH',
    'TOKEN_PURPOSE_MISMATCH',
    'TOKEN_SUBJECT_MISMATCH',
    'LEGACY_TOKEN_REJECTED',
    'MISSING_REFRESH_TOKEN',
    'INVALID_REFRESH_TOKEN',
    'REFRESH_ACTOR_MISMATCH',
    'REFRESH_TOKEN_REUSE',
    'EXPIRED_REFRESH_TOKEN',
]);
const JWT_ERRORS = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);

function sendAuthFailure(res, error, invalidMessage = 'Sessão inválida') {
    if (INVALID_SESSION_CODES.has(error?.code) || JWT_ERRORS.has(error?.name)) {
        return res.status(401).json({ message: invalidMessage });
    }
    return res.status(503).json({
        message: 'Serviço de autenticação temporariamente indisponível. Tente novamente em instantes.',
    });
}

module.exports = { sendAuthFailure };
