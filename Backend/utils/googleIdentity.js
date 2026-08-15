'use strict';

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function googleIdentityError(code, message, statusCode = 401) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function validateGoogleIdentityClaims(decodedToken = {}) {
    const uid = typeof decodedToken.uid === 'string' ? decodedToken.uid.trim() : '';
    const email = normalizeEmail(decodedToken.email);
    const provider = decodedToken.firebase?.sign_in_provider;

    if (!uid || uid.length > 128) {
        throw googleIdentityError('GOOGLE_UID_REQUIRED', 'Identidade Google sem UID válido.');
    }
    if (provider !== 'google.com') {
        throw googleIdentityError('GOOGLE_PROVIDER_INVALID', 'O token não foi emitido por uma conta Google.');
    }
    if (decodedToken.email_verified !== true) {
        throw googleIdentityError('GOOGLE_EMAIL_UNVERIFIED', 'A conta Google precisa ter um e-mail verificado.');
    }
    if (!email || email.length > 320) {
        throw googleIdentityError('GOOGLE_EMAIL_REQUIRED', 'A conta Google não informou um e-mail válido.');
    }

    return {
        uid,
        email,
        name: typeof decodedToken.name === 'string' ? decodedToken.name.trim() : '',
        picture: typeof decodedToken.picture === 'string' ? decodedToken.picture.trim() : '',
    };
}

function isLegacyGoogleEmailLinkEnabled({ allowLegacyEmailLink, legacyLinkUntil, now = Date.now() } = {}) {
    if (String(allowLegacyEmailLink).toLowerCase() !== 'true') return false;
    const deadline = Date.parse(legacyLinkUntil || '');
    return Number.isFinite(deadline) && deadline > now;
}

async function confirmExistingGoogleAccountLink({ user, password, allowLegacyLink = false }) {
    if (!user) {
        throw googleIdentityError('GOOGLE_IDENTITY_CONFLICT', 'Conta local não encontrada.', 409);
    }

    if (typeof password === 'string' && password.length > 0) {
        const matches = await user.comparePassword(password);
        if (!matches) {
            throw googleIdentityError(
                'GOOGLE_LINK_PASSWORD_INVALID',
                'A senha atual não confere. Nenhum vínculo foi realizado.',
                401
            );
        }
        return 'password';
    }

    if (allowLegacyLink) return 'legacy-window';

    throw googleIdentityError(
        'GOOGLE_LINK_PASSWORD_REQUIRED',
        'Esta conta já existe. Confirme a senha atual para vinculá-la ao Google.',
        409
    );
}

module.exports = {
    normalizeEmail,
    validateGoogleIdentityClaims,
    isLegacyGoogleEmailLinkEnabled,
    confirmExistingGoogleAccountLink,
};
