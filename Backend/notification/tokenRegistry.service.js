const NotificationToken = require('../models/notificationToken.model');

// Extraído de services/notification.service.js (Fase 4 da correção do sistema de push,
// 2026-08-02). Único módulo que toca a coleção NotificationToken. Responsabilidade:
// registrar tokens, validar proprietário, remover tokens (por pedido do dono, ou porque
// o Firebase reportou que não existem mais).

// Fase 7 da correção do sistema de push (2026-08-02): admin virou um terceiro tipo de
// dono possível (canal de push pro painel administrativo), além de passageiro/motorista.
const OWNER_FIELD = { user: 'userId', captain: 'captainId', admin: 'adminId' };
const ALL_OWNER_FIELDS = Object.values(OWNER_FIELD);

// C4 da auditoria de push (2026-08-02): nunca grava `null` nos campos que não se
// aplicam — só o campo do dono real é setado; os outros são removidos do documento via
// $unset. Antes, gravar `null` explícito fazia consultas de segmentação tipo
// `{campo: {$exists:true}}` casarem com QUALQUER documento (null também "exists"),
// vazando notificação de motorista pra passageiro e vice-versa.
//
// A4: não bloqueia reatribuição — dispositivo compartilhado (outra conta loga no mesmo
// aparelho depois) é um uso legítimo — mas devolve se houve reatribuição, pra quem
// chamar poder registrar um rastro auditável.
module.exports.registerToken = async ({ ownerType, ownerId, token, device }) => {
    const ownerField = OWNER_FIELD[ownerType];
    const otherFields = ALL_OWNER_FIELDS.filter(field => field !== ownerField);

    const existing = await NotificationToken.findOne({ token });
    const reassigned = !!(existing && existing[ownerField] && existing[ownerField].toString() !== ownerId.toString());
    const previousOwner = reassigned ? existing[ownerField] : null;

    const unsetFields = {};
    otherFields.forEach((field) => { unsetFields[field] = ''; });

    await NotificationToken.findOneAndUpdate(
        { token },
        {
            $set: { [ownerField]: ownerId, device: device || 'web' },
            $unset: unsetFields
        },
        { upsert: true, new: true }
    );

    return { reassigned, previousOwner };
};

// A3: só remove se o token realmente pertencer a quem está pedindo — impede que uma
// sessão remova (por engano ou má-fé) o token de outra conta.
module.exports.unregisterToken = async ({ ownerType, ownerId, token }) => {
    const ownerField = OWNER_FIELD[ownerType];
    const result = await NotificationToken.deleteOne({ token, [ownerField]: ownerId });
    return result.deletedCount > 0;
};

module.exports.getTokensForUser = async (userId) => {
    const docs = await NotificationToken.find({ userId });
    return docs.map(d => d.token);
};

module.exports.getTokensForCaptain = async (captainId) => {
    const docs = await NotificationToken.find({ captainId });
    return docs.map(d => d.token);
};

/** Tokens do motorista com device (para split Android APK vs Web/PWA). */
module.exports.getTokenEntriesForCaptain = async (captainId) => {
    const docs = await NotificationToken.find({ captainId }).select('token device').lean();
    return docs.map((d) => ({
        token: d.token,
        device: String(d.device || 'web').toLowerCase(),
    }));
};

module.exports.getTokensForUsers = async (userIds) => {
    const docs = await NotificationToken.find({ userId: { $in: userIds } });
    return docs.map(d => d.token);
};

module.exports.getTokensForCaptains = async (captainIds) => {
    const docs = await NotificationToken.find({ captainId: { $in: captainIds } });
    return docs.map(d => d.token);
};

// Usados por sendAdminNotification. C4: `{$ne: null}` só casa quando o campo existe E
// tem valor real — ao contrário de `{$exists:true}`, que também casava com null.
module.exports.getAllPassengerTokens = async () => {
    const docs = await NotificationToken.find({ userId: { $ne: null } });
    return docs.map(d => d.token);
};

module.exports.getAllDriverTokens = async () => {
    const docs = await NotificationToken.find({ captainId: { $ne: null } });
    return docs.map(d => d.token);
};

// Fase 7: canal de push para o painel administrativo.
module.exports.getAllAdminTokens = async () => {
    const docs = await NotificationToken.find({ adminId: { $ne: null } });
    return docs.map(d => d.token);
};

// A2 da auditoria de push (achado que já existia, implementado agora como parte da
// Fase 4): remove tokens que o Firebase reportou como definitivamente inválidos — sem
// isto a base de tokens só cresce e a taxa de falha de cada envio sobe pra sempre.
module.exports.removeInvalidTokens = async (tokens) => {
    if (!tokens || tokens.length === 0) return 0;
    const result = await NotificationToken.deleteMany({ token: { $in: tokens } });
    return result.deletedCount;
};
