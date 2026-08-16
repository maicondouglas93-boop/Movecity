const rateLimit = require('express-rate-limit');

// Chave por IP + rota: sem isso, /users/login, /captains/login e /api/admin/login
// compartilham o mesmo balde de 5 tentativas (mesma instância, mesmo módulo
// importado pelos três routers) — um IP que erra login de passageiro repetidas
// vezes ficava sem tentar login de admin por 15 minutos, mesmo sem relação alguma
// entre as contas.
module.exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // max 5 tentativas
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => `login:${req.baseUrl}${req.path}:${req.ip}`,
    // Suítes de integração legitimamente logam a mesma rota mais de 5 vezes em
    // sequência (uma sessão nova por cenário) — nenhum teste hoje verifica o limite
    // em si, então bloqueá-lo em produção sem travar a suíte é estritamente melhor
    // do que deixar a proteção real mais fraca só para caber no teste.
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: "Muitas tentativas de login. Tente novamente em 15 minutos." }
});

// A4 da auditoria de push (2026-08-02): registrar um token FCM é reivindicar a
// propriedade dele (quem registra por último recebe as notificações daquele
// dispositivo). Sem limite, uma conta comprometida podia tentar reivindicar tokens
// alheios em série. Uma renovação legítima de token não passa disso em 15 minutos.
module.exports.notificationTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: "Muitas tentativas de registro de notificação. Tente novamente em 15 minutos." }
});

module.exports.accountDeletionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Muitas solicitações. Tente novamente mais tarde.' }
});

// Plano de correção (Fase 1.2, 2026-08-16): troca de senha autenticada — mesmo padrão
// do accountDeletionLimiter, pra não permitir brute-force da senha atual via este
// endpoint (ele já autentica por JWT, mas ainda aceita tentativas repetidas de senha).
module.exports.changePasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Muitas tentativas. Tente novamente mais tarde.' }
});

// PIN de entrega: limita brute-force por captain (4 dígitos).
module.exports.parcelPinLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => {
        const captainId = req.captain?._id?.toString?.() || req.ip || 'anon';
        const parcelId = req.params?.id || 'unknown';
        return `parcel-pin:${captainId}:${parcelId}`;
    },
    message: { message: 'Muitas tentativas de PIN. Tente novamente em alguns minutos.' },
});

// PIN de início de corrida (6 dígitos) — auditoria presencial A6.
module.exports.rideStartPinLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => {
        const captainId = req.captain?._id?.toString?.() || req.ip || 'anon';
        const rideId = req.query?.rideId || 'unknown';
        return `ride-start-pin:${captainId}:${rideId}`;
    },
    message: { message: 'Muitas tentativas de PIN. Tente novamente em alguns minutos.' },
});

// Snapshot pré-corrida: impede varredura automatizada de várias cidades/áreas por uma
// conta autenticada. O cliente legítimo renova a assinatura curta a cada quatro minutos.
module.exports.publicDriverMapLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => `public-driver-map:${req.user?._id?.toString?.() || req.ip || 'anon'}`,
    message: { message: 'Muitas consultas ao mapa. Aguarde alguns minutos.' },
});
