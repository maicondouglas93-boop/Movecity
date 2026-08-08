const NotificationToken = require('../models/notificationToken.model');
const { getCache, setCache, deleteByPrefix } = require('../cache/cache');

// Extraído de services/notification.service.js (Fase 4 da correção do sistema de push,
// 2026-08-02). Único módulo que toca a coleção NotificationToken. Responsabilidade:
// registrar tokens, validar proprietário, remover tokens (por pedido do dono, ou porque
// o Firebase reportou que não existem mais).

// Fase 7 da correção do sistema de push (2026-08-02): admin virou um terceiro tipo de
// dono possível (canal de push pro painel administrativo), além de passageiro/motorista.
const OWNER_FIELD = { user: 'userId', captain: 'captainId', admin: 'adminId' };
const ALL_OWNER_FIELDS = Object.values(OWNER_FIELD);
// Auditoria de cache (2026-08-08, A2): mapa inverso pra invalidar o cache do dono
// ANTERIOR mesmo quando a reatribuição muda de TIPO (ex.: mesmo aparelho era
// passageiro, agora é motorista) — nesse caso o campo antigo (userId) é diferente
// do novo (captainId), então não dá pra achar o dono anterior só olhando o campo novo.
const OWNER_TYPE_BY_FIELD = Object.fromEntries(
    Object.entries(OWNER_FIELD).map(([type, field]) => [field, type])
);
const invalidateTokenCache = (ownerType, ownerId) => {
    if (!ownerType || !ownerId) return;
    deleteByPrefix(`fcm-tokens:${ownerType}:${ownerId}`);
};

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

    // Auditoria de cache (2026-08-08, A2): invalida o dono novo (token passou a
    // valer pra ele). Também invalida TODO dono anterior que o documento tinha —
    // não só o mesmo campo/tipo do novo dono — porque $unset acima pode estar
    // limpando um tipo diferente (ex.: era userId, virou captainId); sem isso o
    // dono antigo de outro tipo continuaria recebendo push nesse token até o TTL.
    invalidateTokenCache(ownerType, ownerId);
    if (existing) {
        ALL_OWNER_FIELDS.forEach((field) => {
            const previousId = existing[field];
            if (previousId) invalidateTokenCache(OWNER_TYPE_BY_FIELD[field], previousId);
        });
    }

    return { reassigned, previousOwner };
};

// A3: só remove se o token realmente pertencer a quem está pedindo — impede que uma
// sessão remova (por engano ou má-fé) o token de outra conta.
module.exports.unregisterToken = async ({ ownerType, ownerId, token }) => {
    const ownerField = OWNER_FIELD[ownerType];
    const result = await NotificationToken.deleteOne({ token, [ownerField]: ownerId });
    if (result.deletedCount > 0) invalidateTokenCache(ownerType, ownerId);
    return result.deletedCount > 0;
};

// Auditoria de cache (2026-08-08, A2): um motorista recebe 4-6+ pushes numa
// corrida normal (oferta, aceite, pagamento, chat...) — cada um relia o mesmo
// token no Mongo. Token só muda em login/logout/reinstall, então tolera minutos
// de atraso; pior caso de cache velho é tentar mandar pra um token já revogado,
// que o próprio FCM já reporta como erro sem quebrar nada (não é entregar pra
// pessoa errada). TTL curto (300s) porque cada chave cacheada é pequena e barata
// de recalcular — não precisa esticar.
// Nota de chave: todo cache deste dono vive sob `fcm-tokens:<type>:<id>:...` —
// o prefixo comum (sem o sufixo) é o que invalidateTokenCache usa pra limpar TODAS
// as variantes (lista simples + entries) de uma vez via deleteByPrefix.
module.exports.getTokensForUser = async (userId) => {
    const cacheKey = `fcm-tokens:user:${userId}:list`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const docs = await NotificationToken.find({ userId });
    const tokens = docs.map(d => d.token);
    setCache(cacheKey, tokens, 300);
    return tokens;
};

module.exports.getTokensForCaptain = async (captainId) => {
    const cacheKey = `fcm-tokens:captain:${captainId}:list`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const docs = await NotificationToken.find({ captainId });
    const tokens = docs.map(d => d.token);
    setCache(cacheKey, tokens, 300);
    return tokens;
};

/** Tokens do motorista com device (para split Android APK vs Web/PWA). */
module.exports.getTokenEntriesForCaptain = async (captainId) => {
    // Chave própria (não a de getTokensForCaptain) — formato de retorno diferente
    // ({token, device} vs string) pro mesmo dono, mas sob o mesmo prefixo
    // `fcm-tokens:captain:<id>:` pra cair junto na invalidação.
    const cacheKey = `fcm-tokens:captain:${captainId}:entries`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const docs = await NotificationToken.find({ captainId }).select('token device').lean();
    const entries = docs.map((d) => ({
        token: d.token,
        device: String(d.device || 'web').toLowerCase(),
    }));
    setCache(cacheKey, entries, 300);
    return entries;
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
    // Auditoria de cache (2026-08-08, A2): não sabemos os donos aqui sem uma
    // consulta extra (só temos os tokens em si, já deletados) — chamada rara
    // (só quando o FCM reporta token inválido), então limpar tudo é mais simples
    // e seguro que arriscar deixar um dono com cache velho até o TTL.
    if (result.deletedCount > 0) deleteByPrefix('fcm-tokens:');
    return result.deletedCount;
};
