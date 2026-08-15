const socketIo = require('socket.io');
const crypto = require('node:crypto');
const authService = require('./services/auth.service');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const rideModel = require('./models/ride.model');
const parcelModel = require('./models/parcel.model');
const adminUserModel = require('./models/adminUser.model');
const socketSessionModel = require('./models/socketSession.model');
const {
    INSTANCE_ID,
    registerRevocationHandler,
    startRevocationSubscriber,
    stopRevocationSubscriber,
} = require('./services/sessionRevocation.service');
const mapService = require('./services/maps.service');
const notificationDispatcher = require('./notification/notificationDispatcher.service');
const {
    MAX_OFFLINE_LOCATION_AGE_MS,
    normalizeCaptainLocation,
} = require('./utils/captainLocationValidation');
const { processRideTrackingPoint } = require('./services/rideTracking.service');
const { calculateLiveRideFare } = require('./services/liveRideFare.service');

let io;

const SOCKET_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SOCKET_IDENTITY_REVALIDATE_MS = Math.max(
    5000,
    Number(process.env.SOCKET_IDENTITY_REVALIDATE_MS) || 30000
);

const actorRoom = (actorType, actorId) => `actor:${actorType}:${actorId}`;

function deviceIdHash(deviceId, jti) {
    const safeDeviceId = typeof deviceId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(deviceId)
        ? deviceId
        : `access-jti:${jti}`;
    return crypto.createHash('sha256').update(safeDeviceId).digest('hex');
}

function eventTargetsIdentity(event, identity) {
    if (!event || !identity) return false;
    if (event.actorType !== identity.type || String(event.actorId) !== String(identity.id)) return false;
    return event.scope === 'account' || event.jti === identity.jti;
}

function disconnectRevokedSockets(event, ioServer = io) {
    if (!ioServer?.sockets?.sockets) return 0;
    let disconnected = 0;
    for (const socket of ioServer.sockets.sockets.values()) {
        if (!eventTargetsIdentity(event, socket.data?.identity)) continue;
        socket.emit('session-revoked', { code: 'SESSION_REVOKED', reason: event.reason });
        socket.disconnect(true);
        disconnected += 1;
    }
    return disconnected;
}

registerRevocationHandler(async (event) => {
    const disconnected = disconnectRevokedSockets(event);
    // O campo socketId permanece apenas como ponteiro legado. Numa revogação de conta,
    // duas rotinas de disconnect podem terminar fora de ordem e apontar uma para a
    // sessão já encerrada da outra; limpar depois de iniciar todas as desconexões evita
    // esse estado sem voltar a usá-lo como fonte de verdade.
    if (disconnected > 0 && event.scope === 'account') {
        const model = event.actorType === 'user'
            ? userModel
            : (event.actorType === 'captain' ? captainModel : null);
        if (model) await model.updateOne({ _id: event.actorId }, { $set: { socketId: null } });
    }
    return disconnected;
});

async function findReplacementSocket(identity, excludedSocketId) {
    if (!identity || identity.type === 'admin') return null;
    return socketSessionModel.findOne({
        actorType: identity.type,
        actorId: identity.id,
        socketId: { $ne: excludedSocketId },
        disconnectedAt: null,
        tokenExpiresAt: { $gt: new Date() },
    }).sort({ lastValidatedAt: -1 }).lean();
}

async function releaseSocketIdentity(socket, reason = 'disconnected') {
    const identity = socket.data?.identity;
    clearTimeout(socket.data?.identityExpiryTimer);
    clearInterval(socket.data?.identityValidationTimer);
    socket.data.identityExpiryTimer = null;
    socket.data.identityValidationTimer = null;

    if (!identity) return null;
    // Expiração e revalidação periódica podem disparar quase no mesmo instante. Retirar
    // a identidade antes do primeiro await torna a liberação idempotente e impede dois
    // fluxos concorrentes de remover presença ou reescrever o ponteiro legado duas vezes.
    socket.data.identity = null;

    if (socket.data.chatIdentities) {
        for (const [key, chatIdentity] of socket.data.chatIdentities.entries()) {
            removeChatPresence(key, chatIdentity.type);
        }
    }
    socket.data.authorizedChats = new Set();
    socket.data.chatIdentities = new Map();
    socket.data.chatSubjects = new Map();
    for (const room of [...socket.rooms]) {
        if (room !== socket.id) socket.leave(room);
    }

    await socketSessionModel.updateOne({ socketId: socket.id, disconnectedAt: null }, {
        $set: {
            disconnectedAt: new Date(),
            disconnectReason: reason,
            purgeAt: new Date(Date.now() + SOCKET_SESSION_RETENTION_MS),
        }
    }).catch((error) => console.error('[SocketSession] Failed to close session:', error.message));

    const replacement = await findReplacementSocket(identity, socket.id);
    if (identity.type === 'user') {
        await userModel.updateOne(
            { _id: identity.id, socketId: socket.id },
            { $set: { socketId: replacement?.socketId || null } }
        );
    } else if (identity.type === 'captain') {
        const captainBefore = await captainModel.findOneAndUpdate(
            { _id: identity.id, socketId: socket.id },
            { $set: { socketId: replacement?.socketId || null } }
        );
        if (!replacement && captainBefore?.isOnline) {
            const captainService = require('./services/captain.service');
            await captainService.endOnlineSession(captainBefore._id);
            const { deleteByPrefix } = require('./cache/cache');
            deleteByPrefix(`profile:captain:${captainBefore._id}`);
            deleteByPrefix('drivers:');
        }
    }
    return identity;
}

async function accountIsActive(identity) {
    if (identity.type === 'user') {
        const account = await userModel.findById(identity.id).select('_id isBlocked').lean();
        return Boolean(account && !account.isBlocked);
    }
    if (identity.type === 'captain') {
        const account = await captainModel.findById(identity.id).select('_id isBlocked').lean();
        return Boolean(account && !account.isBlocked);
    }
    if (identity.type === 'admin') {
        const account = await adminUserModel.findById(identity.id).select('_id active').lean();
        return Boolean(account?.active);
    }
    return false;
}

async function revalidateSocketIdentity(socket, expectedType = null, { force = false } = {}) {
    const identity = socket.data?.identity;
    if (!identity || (expectedType && identity.type !== expectedType)) return false;

    if (identity.tokenExpiresAt.getTime() <= Date.now()) {
        await releaseSocketIdentity(socket, 'access_token_expired');
        socket.emit('reauth-required', { code: 'ACCESS_TOKEN_EXPIRED' });
        return false;
    }

    if (!force && Date.now() - identity.lastValidatedAt < SOCKET_IDENTITY_REVALIDATE_MS) return true;
    const active = await accountIsActive(identity);
    if (!active) {
        socket.emit('session-revoked', { code: 'ACCOUNT_INACTIVE' });
        socket.disconnect(true);
        return false;
    }

    identity.lastValidatedAt = Date.now();
    await socketSessionModel.updateOne({ socketId: socket.id, disconnectedAt: null }, {
        $set: { lastValidatedAt: new Date(identity.lastValidatedAt) }
    }).catch((error) => console.error('[SocketSession] Failed to touch session:', error.message));
    return true;
}

function scheduleSocketIdentityChecks(socket) {
    clearTimeout(socket.data.identityExpiryTimer);
    clearInterval(socket.data.identityValidationTimer);
    const expiresIn = Math.max(0, socket.data.identity.tokenExpiresAt.getTime() - Date.now());
    socket.data.identityExpiryTimer = setTimeout(() => {
        revalidateSocketIdentity(socket, null, { force: true }).catch((error) => {
            console.error('[SocketSession] Expiry check failed:', error.message);
            socket.disconnect(true);
        });
    }, expiresIn + 25);
    socket.data.identityExpiryTimer.unref?.();

    socket.data.identityValidationTimer = setInterval(() => {
        revalidateSocketIdentity(socket, null, { force: true }).catch((error) => {
            console.error('[SocketSession] Periodic validation failed:', error.message);
            socket.disconnect(true);
        });
    }, SOCKET_IDENTITY_REVALIDATE_MS);
    socket.data.identityValidationTimer.unref?.();
}

async function bindSocketIdentity(socket, { decoded, actorType, actorId, token, deviceId }) {
    const jti = decoded.jti || `legacy:${authService.hashToken(token).slice(0, 32)}`;
    const tokenExpiresAt = new Date(Number(decoded.exp || 0) * 1000);
    if (!Number.isFinite(tokenExpiresAt.getTime()) || tokenExpiresAt.getTime() <= Date.now()) {
        throw new Error('Access token expirado.');
    }

    const previous = socket.data?.identity;
    if (previous && (
        previous.type !== actorType
        || String(previous.id) !== String(actorId)
        || previous.jti !== jti
    )) {
        await releaseSocketIdentity(socket, 'identity_replaced');
    }

    const identity = {
        type: actorType,
        id: String(actorId),
        jti,
        legacy: decoded.legacy,
        tokenExpiresAt,
        lastValidatedAt: Date.now(),
    };
    socket.data.identity = identity;
    socket.join(actorRoom(actorType, actorId));

    await socketSessionModel.findOneAndUpdate({ socketId: socket.id }, {
        $set: {
            actorType,
            actorId,
            jti,
            deviceIdHash: deviceIdHash(deviceId, jti),
            instanceId: INSTANCE_ID,
            tokenExpiresAt,
            lastValidatedAt: new Date(identity.lastValidatedAt),
            disconnectedAt: null,
            disconnectReason: '',
            purgeAt: new Date(tokenExpiresAt.getTime() + SOCKET_SESSION_RETENTION_MS),
        },
        $setOnInsert: { connectedAt: new Date() },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    scheduleSocketIdentityChecks(socket);
    return identity;
}

// A7 da auditoria de push (2026-08-02): "quem está de fato olhando este chat agora" —
// contagem por corrida/encomenda e por tipo (não por socket, pra suportar a mesma pessoa com duas
// abas/dispositivos abertos sem que sair de uma derrube a presença da outra). Usado por
// 'send-message' pra decidir: destinatário presente -> só Socket.IO (como já era);
// destinatário ausente -> cai pro push (antes não existia nenhum aviso nesse caso).
// chatKey = rideId (compat corrida) ou `parcel:<id>`
const chatPresence = new Map();

const chatRoomKey = ({ subjectType, subjectId, rideId } = {}) => {
    const type = subjectType === 'parcel' ? 'parcel' : 'ride';
    const id = (subjectId || rideId || '').toString();
    if (!id) return null;
    return type === 'parcel' ? `parcel:${id}` : id;
};

const chatRoomName = (key) => `chat_${key}`;

const addChatPresence = (key, type) => {
    if (!chatPresence.has(key)) chatPresence.set(key, { user: 0, captain: 0 });
    chatPresence.get(key)[type]++;
};

const removeChatPresence = (key, type) => {
    const presence = chatPresence.get(key);
    if (!presence) return;
    presence[type] = Math.max(0, presence[type] - 1);
    if (presence.user === 0 && presence.captain === 0) chatPresence.delete(key);
};

const isChatPresent = (key, type) => (chatPresence.get(key)?.[type] || 0) > 0;

/**
 * Publica somente mensagens que já foram persistidas pelo endpoint HTTP.
 * A gravação no Mongo é a fonte de verdade; Socket.IO e FCM são consequências dela.
 */
const publishPersistedChatMessage = async ({ subject, message, senderType }) => {
    const subjectType = subject?.subjectType === 'parcel' ? 'parcel' : 'ride';
    const subjectId = subject?.subjectId;
    const key = chatRoomKey({ subjectType, subjectId, rideId: subjectId });
    if (!key) return { realtimeRecipients: 0, pushQueued: false };

    const recipientType = senderType === 'user' ? 'captain' : 'user';
    let realtimeRecipients = 0;

    if (io) {
        const roomSockets = io.sockets.adapter.rooms.get(chatRoomName(key)) || new Set();
        for (const socketId of roomSockets) {
            const targetSocket = io.sockets.sockets.get(socketId);
            const identity = targetSocket?.data.chatIdentities?.get(key);
            if (identity?.type === recipientType) {
                targetSocket.emit('receive-message', message);
                realtimeRecipients += 1;
            }
        }
    }

    // Uma mensagem operacional não deve revelar o PIN na tela bloqueada. O conteúdo
    // integral continua no histórico persistido e chega em realtime quando o chat está aberto.
    const preview = message?.operationalType === 'delivery_pin'
        ? 'Você recebeu um PIN pelo chat. Abra o app para visualizar.'
        : (typeof message?.message === 'string' ? message.message.slice(0, 100) : 'Nova mensagem');
    const pushMeta = subjectType === 'parcel'
        ? { subjectType, subjectId: String(subjectId), parcelId: String(subjectId) }
        : { subjectType, subjectId: String(subjectId), rideId: String(subjectId) };

    if (realtimeRecipients === 0 && !isChatPresent(key, recipientType)) {
        if (recipientType === 'captain' && subject.captainId) {
            await notificationDispatcher.sendChatMessageToCaptain(subject.captainId, preview, pushMeta);
            return { realtimeRecipients, pushQueued: true };
        }
        if (recipientType === 'user' && subject.userId) {
            await notificationDispatcher.sendChatMessageToUser(subject.userId, preview, pushMeta);
            return { realtimeRecipients, pushQueued: true };
        }
    }

    return { realtimeRecipients, pushQueued: false };
};

function initializeSocket(server) {
    // Mesma lista do REST (Backend/config/corsOrigins.js) — ver o comentário lá
    // sobre o APK ser barrado no handshake do Socket enquanto passava no REST.
    const { corsOriginCallback } = require('./config/corsOrigins');

    io = socketIo(server, {
        transports: [ 'websocket', 'polling' ],
        cors: {
            origin: corsOriginCallback,
            methods: [ 'GET', 'POST' ],
            credentials: true
        }
    });

    startRevocationSubscriber();
    server.once('close', () => {
        stopRevocationSubscriber().catch(() => {});
    });

    io.on('connection', (socket) => {
        console.log(`[AUDIT] Client connected: ${socket.id}`);

        socket.on('join', async (data, ack) => {
            const { userId, userType, token, deviceId } = data || {};
            console.log(`[AUDIT] User ${userId} (${userType}) solicitou JOIN no socket ${socket.id}`);

            // Auditoria PWA (2026-08-03, C1/C2): antes, `join` de user/captain confiava
            // cegamente no `userId` mandado pelo cliente, sem verificar token nenhum —
            // qualquer socket podia se anunciar como qualquer usuário/motorista real e
            // passar a receber, no lugar da vítima, todo evento endereçado por
            // `socketId` (localização do motorista, atualização de corrida etc). O join
            // de admin já exigia token (S1, auditoria anterior); agora o mesmo padrão
            // vale para user/captain. A identidade verificada fica em `socket.data`
            // (memória do próprio socket) e é o que `update-location-captain` passa a
            // confiar, nunca mais o campo solto do payload.
            //
            // `ack`: callback opcional (socket.io emit-with-callback). Sem ele, o
            // cliente não tem como saber QUANDO o join terminou de verificar o token —
            // e como o handler tem `await`s no meio, um evento seguinte (ex.:
            // update-location-captain) emitido logo em seguida podia chegar e ser
            // processado ANTES de `socket.data.identity` estar setado, sendo rejeitado
            // à toa. O ack dá ao cliente um ponto real de "agora sim pode mandar".
            const reject = (message) => {
                socket.emit('unauthorized', { message });
                if (typeof ack === 'function') ack({ ok: false, message });
            };

            if (userType === 'user' || userType === 'captain') {
                if (!token) {
                    console.log(`[AUDIT] JOIN ${userType} rejeitado (sem token) no socket ${socket.id}`);
                    return reject('Token ausente');
                }
                let decoded;
                try {
                    decoded = authService.verifyAccessToken(token, userType);
                } catch (err) {
                    console.log(`[AUDIT] JOIN ${userType} rejeitado (token inválido) no socket ${socket.id}`);
                    return reject('Token inválido');
                }
                const authenticatedId = decoded.subjectId;
                const authenticatedType = decoded.actorType || userType;

                if (authenticatedType === 'user') {
                    const user = await userModel.findById(authenticatedId);
                    if (!user || user.isBlocked) {
                        console.log(`[AUDIT] JOIN user rejeitado (inválido/bloqueado) no socket ${socket.id}`);
                        return reject('Usuário inválido');
                    }
                    try {
                        await bindSocketIdentity(socket, {
                            decoded,
                            actorType: 'user',
                            actorId: authenticatedId,
                            token,
                            deviceId,
                        });
                    } catch (error) {
                        console.error('[SocketSession] Falha ao registrar usuário:', error.message);
                        return reject('Não foi possível registrar a sessão do socket');
                    }
                    await userModel.findByIdAndUpdate(authenticatedId, { socketId: socket.id });
                    console.log(`[AUDIT] User ${authenticatedId} atualizou socketId para ${socket.id}`);

                    const dispatchService = require('./services/dispatch.service');
                    const userParcelStatuses = [
                        'awaiting_provider',
                        ...dispatchService.ACTIVE_PARCEL_STATUSES,
                        'delivered',
                    ];
                    const activeUserParcel = await parcelModel.findOne({
                        user: authenticatedId,
                        status: { $in: userParcelStatuses },
                    }).select('_id');
                    if (activeUserParcel) {
                        socket.join(`parcel_${activeUserParcel._id}`);
                        console.log(`[AUDIT] User ${authenticatedId} reentrou na sala parcel_${activeUserParcel._id} após (re)conexão`);
                    }
                } else {
                    const captain = await captainModel.findById(authenticatedId);
                    if (!captain || captain.isBlocked) {
                        console.log(`[AUDIT] JOIN captain rejeitado (inválido/bloqueado) no socket ${socket.id}`);
                        return reject('Motorista inválido');
                    }
                    try {
                        await bindSocketIdentity(socket, {
                            decoded,
                            actorType: 'captain',
                            actorId: authenticatedId,
                            token,
                            deviceId,
                        });
                    } catch (error) {
                        console.error('[SocketSession] Falha ao registrar motorista:', error.message);
                        return reject('Não foi possível registrar a sessão do socket');
                    }

                    // Separação disponibilidade x conexão (2026-08-03): `lastSeenAt` é o
                    // heartbeat que mantém o motorista no despacho. Reconectar conta como
                    // contato real.
                    const captainBefore = await captainModel.findByIdAndUpdate(
                        authenticatedId,
                        { socketId: socket.id, lastSeenAt: new Date() }
                    );
                    console.log(`[AUDIT] Captain ${authenticatedId} atualizou socketId para ${socket.id}`);

                    // O tempo online mede tempo realmente CONECTADO (o disconnect fecha a
                    // sessão). Se o motorista continua disponível e voltou a conectar, uma
                    // nova sessão começa aqui — sem isso, reabrir o app depois de uma queda
                    // deixaria de contar o tempo até o próximo toggle.
                    if (captainBefore && captainBefore.isOnline && !captainBefore.onlineSince) {
                        const captainService = require('./services/captain.service');
                        await captainService.startOnlineSession(authenticatedId);
                    }

                    // Fase A da experiência de corrida ativa (2026-08-03): a sala
                    // `ride_<id>` é populada por socketId no momento do despacho/aceite —
                    // qualquer reconexão gera um socketId novo que NÃO estava na sala, e o
                    // motorista designado deixava de receber 'ride-cancelled' /
                    // 'ride-reassigned-by-admin' da corrida em que ele está agora.
                    // Reentrar aqui garante que todo join autenticado volte à sala da
                    // corrida ativa dele.
                    const activeRide = await rideModel.findOne({
                        captain: authenticatedId,
                        status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ] }
                    }).select('_id');
                    if (activeRide) {
                        socket.join(`ride_${activeRide._id}`);
                        console.log(`[AUDIT] Captain ${authenticatedId} reentrou na sala ride_${activeRide._id} após (re)conexão`);
                    }

                    const dispatchService = require('./services/dispatch.service');
                    const activeParcel = await parcelModel.findOne({
                        captain: authenticatedId,
                        status: { $in: dispatchService.ACTIVE_PARCEL_STATUSES },
                    }).select('_id');
                    if (activeParcel) {
                        socket.join(`parcel_${activeParcel._id}`);
                        console.log(`[AUDIT] Captain ${authenticatedId} reentrou na sala parcel_${activeParcel._id} após (re)conexão`);
                    }
                }
            } else if (userType === 'admin') {
                // Auditoria de segurança (2026-08-02, S1): a sala admin_room recebe GPS
                // em tempo real de toda a frota. Sem checar o token aqui, qualquer cliente
                // de socket podia entrar mandando { userType: 'admin' } e escutar a
                // localização de todos os motoristas online.
                if (!token) {
                    console.log(`[AUDIT] JOIN admin rejeitado (sem token) no socket ${socket.id}`);
                    return reject('Token de admin ausente');
                }
                try {
                    const decoded = authService.verifyAccessToken(token, 'admin');
                    const admin = await adminUserModel.findById(decoded.subjectId);
                    if (!admin || !admin.active) {
                        console.log(`[AUDIT] JOIN admin rejeitado (inativo/inexistente) no socket ${socket.id}`);
                        return reject('Admin inválido');
                    }
                    await bindSocketIdentity(socket, {
                        decoded,
                        actorType: 'admin',
                        actorId: decoded.subjectId,
                        token,
                        deviceId,
                    });
                    socket.join('admin_room');
                    console.log(`[AUDIT] Admin ${admin.email} entrou em admin_room via socket ${socket.id}`);
                } catch (err) {
                    console.log(`[AUDIT] JOIN admin rejeitado (token inválido) no socket ${socket.id}`);
                    return reject('Token de admin inválido');
                }
            } else {
                return reject('Tipo de usuário inválido');
            }

            if (typeof ack === 'function') ack({ ok: true });
            socket.emit('identity-restored', { actorType: socket.data.identity?.type });
        });


        socket.on('update-location-captain', async (data, ack) => {
            // Auditoria PWA (2026-08-03, C1): antes, `userId` vinha do payload do
            // cliente sem nenhuma verificação — qualquer socket conectado (nem
            // precisava ter feito join) podia falsificar a localização de QUALQUER
            // motorista, o que também contamina `actualDistance` (usada no cálculo de
            // tarifa) de uma corrida real em andamento. Agora só aceita a localização
            // do motorista que passou pelo `join` autenticado nesta mesma conexão.
            if (!socket.data.identity || socket.data.identity.type !== 'captain') {
                console.log(`[AUDIT] update-location-captain rejeitado (sem identidade de captain autenticada) no socket ${socket.id}`);
                if (typeof ack === 'function') ack({ ok: false, code: 'UNAUTHORIZED' });
                return socket.emit('unauthorized', { message: 'Não autenticado' });
            }
            if (!await revalidateSocketIdentity(socket, 'captain')) {
                if (typeof ack === 'function') ack({ ok: false, code: 'SESSION_INVALID' });
                return;
            }
            const userId = socket.data.identity.id;
            const { location } = data || {};
            const isQueuedRidePoint = Boolean(data?.rideId && data?.pointId);
            const locationValidation = normalizeCaptainLocation(
                location,
                Date.now(),
                isQueuedRidePoint ? { maxAgeMs: MAX_OFFLINE_LOCATION_AGE_MS } : undefined
            );
            if (!locationValidation.valid) {
                if (typeof ack === 'function') {
                    ack({ ok: true, accepted: false, code: locationValidation.code, pointId: data?.pointId });
                }
                return socket.emit('error', { message: 'Invalid location data', code: locationValidation.code });
            }
            const captainLocation = locationValidation.location;

            // Fase C (2026-08-03): `{ new: true }` pra ter o doc atualizado em mãos —
            // o broadcast pro mapa do passageiro (abaixo) precisa de vehicle/isOnline
            // sem uma segunda query.
            const captainDoc = await captainModel.findByIdAndUpdate(userId, {
                location: {
                    ltd: captainLocation.lat,
                    lng: captainLocation.lng
                },
                locationGeoJSON: {
                    type: 'Point',
                    coordinates: [captainLocation.lng, captainLocation.lat]
                },
                // Heartbeat da separação disponibilidade x conexão (2026-08-03): o app
                // do motorista já emite este evento periodicamente, então ele é o
                // batimento natural — sem exigir nada novo do cliente.
                lastSeenAt: new Date()
            }, { new: true });

            // Find active ride for this captain and emit update to the rider
            const ride = await rideModel.findOne({
                captain: userId,
                status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing' ] }
            }).populate('user');

            const dispatchService = require('./services/dispatch.service');
            const parcel = !ride
                ? await parcelModel.findOne({
                    captain: userId,
                    status: { $in: dispatchService.ACTIVE_PARCEL_STATUSES },
                }).populate('user')
                : null;
            let trackingAck = null;

            if (ride) {
                let currentDistance = ride.actualDistance || 0;
                let liveFare = null;

                if (ride.status === 'started' || ride.status === 'ongoing') {
                    // Registros antigos de disponibilidade não têm rideId. Se forem
                    // drenados enquanto uma corrida está ativa, não podem virar km
                    // financeiros da corrida por acidente. Eventos live legados (sem
                    // pointId) continuam compatíveis e usam a corrida ativa.
                    if (data?.pointId && !data?.rideId) {
                        trackingAck = {
                            confirmed: true,
                            accepted: false,
                            reason: 'RIDE_ID_REQUIRED',
                            pointId: data.pointId,
                            actualDistance: currentDistance,
                        };
                    } else if (String(data?.rideId || ride._id) !== ride._id.toString()) {
                        trackingAck = {
                            confirmed: true,
                            accepted: false,
                            reason: 'RIDE_MISMATCH',
                            pointId: data?.pointId,
                            actualDistance: currentDistance,
                        };
                    } else {
                        trackingAck = await processRideTrackingPoint({
                            rideId: ride._id,
                            captainId: userId,
                            location,
                            pointId: data?.pointId,
                        });
                        currentDistance = trackingAck.actualDistance ?? currentDistance;
                    }

                    try {
                        liveFare = await calculateLiveRideFare({
                            ride,
                            actualDistance: currentDistance,
                        });
                    } catch (error) {
                        // Localização e tracking não podem parar se o cálculo de preço
                        // falhar pontualmente. O próximo heartbeat tenta novamente.
                        console.error('Erro calculando valor da corrida em tempo real:', error);
                    }
                }

                const locationUpdate = {
                    ltd: captainLocation.lat,
                    lng: captainLocation.lng,
                    actualDistance: currentDistance,
                    rideId: ride._id.toString(),
                    ...(liveFare ? { liveFare } : {}),
                };

                if (ride.user?._id) {
                    io.to(actorRoom('user', ride.user._id)).emit('captain-location-updated', locationUpdate);
                }
                // Also send back to the captain's socket to update their local map in real time
                socket.emit('captain-location-updated', locationUpdate);
            } else if (parcel) {
                const locPayload = {
                    ltd: captainLocation.lat,
                    lng: captainLocation.lng,
                    parcelId: parcel._id.toString(),
                    subjectType: 'parcel',
                };
                if (parcel.user?._id) {
                    io.to(actorRoom('user', parcel.user._id)).emit('captain-location-updated', locPayload);
                }
                socket.emit('captain-location-updated', locPayload);
            }

            // Painel /rides (2026-08-05): além da coordenada, manda nome/status/veículo
            // para o marcador do mapa admin não ficar genérico ("Motorista Online") e
            // para o bootstrap HTTP + socket falarem o mesmo formato.
            const adminInRide = !!(ride || parcel || captainDoc?.busyLock || captainDoc?.canReceiveRides === false);
            const adminFirst = captainDoc?.fullname?.firstname || '';
            const adminLast = captainDoc?.fullname?.lastname || '';
            io.to('admin_room').emit('admin-captain-location-updated', {
                captainId: userId,
                ltd: captainLocation.lat,
                lng: captainLocation.lng,
                name: `${adminFirst} ${adminLast}`.trim() || 'Motorista',
                status: adminInRide ? 'in_ride' : 'available',
                vehicle: captainDoc?.vehicle ? {
                    plate: captainDoc.vehicle.plate || '',
                    vehicleType: captainDoc.vehicle.vehicleType || '',
                    color: captainDoc.vehicle.color || '',
                    modelo: captainDoc.vehicle.modelo || '',
                } : null,
                vehicleAuthorization: require('./services/vehicleAuthorization.service')
                    .deriveLegacyAuthorization(captainDoc),
                lastSeenAt: new Date().toISOString(),
            });

            // Fase C da experiência de corrida ativa (2026-08-03): mapa do passageiro.
            // Aproveita o pipeline que já existe (posição chega a cada ~10s) e o `ride`
            // já consultado acima — nenhuma query extra. Motorista em corrida/encomenda
            // vira 'driver-busy' (some do mapa); disponível vira 'driver-location'.
            const isBusy = !!(ride || parcel);
            const isAvailableOnMap = !isBusy
                && captainDoc && captainDoc.isOnline && !captainDoc.isBlocked
                && captainDoc.canReceiveRides !== false && captainDoc.approvalStatus === 'aprovado';

            if (isBusy) {
                // Só na TRANSIÇÃO para ocupado. Em corrida a posição chega a cada 5s, e
                // reemitir 'driver-busy' a cada uma delas mandaria a mesma informação
                // repetidas vezes para todos os passageiros com o mapa aberto — eles já
                // removeram esse motorista na primeira.
                emitDriverMapUpdate(userId, { busy: true });
            } else if (isAvailableOnMap) {
                const { deriveLegacyAuthorization } = require('./services/vehicleAuthorization.service');
                emitDriverMapUpdate(userId, {
                    busy: false,
                    vehicleType: captainDoc.vehicle?.vehicleType || 'car',
                    vehicleAuthorization: deriveLegacyAuthorization(captainDoc),
                    location: { ltd: captainLocation.lat, lng: captainLocation.lng }
                });
            }

            if (typeof ack === 'function') {
                if (ride && (ride.status === 'started' || ride.status === 'ongoing')) {
                    // Pontos rejeitados por precisão/outlier também são confirmados:
                    // não contam km, mas saem da fila. Conflitos transitórios ficam na
                    // fila porque `confirmed` é false.
                    ack({
                        ok: trackingAck?.confirmed === true,
                        accepted: trackingAck?.accepted === true,
                        duplicate: trackingAck?.duplicate === true,
                        code: trackingAck?.reason,
                        actualDistance: trackingAck?.actualDistance ?? ride.actualDistance ?? 0,
                        pointId: trackingAck?.pointId || data?.pointId,
                    });
                } else {
                    ack({ ok: true, accepted: true, pointId: data?.pointId });
                }
            }
        });

        // Fase C (2026-08-03): entrada na sala que recebe os motoristas disponíveis em
        // tempo real. Exige o JWT do passageiro no próprio evento (mesmo padrão do
        // join-chat) em vez de depender da ordem do 'join' — e porque posição de frota
        // é dado sensível: sem essa checagem, qualquer socket anônimo poderia assistir
        // a localização de todos os motoristas online.
        socket.on('subscribe-drivers-map', async (data) => {
            const { token, deviceId } = data || {};
            if (!token) {
                return socket.emit('unauthorized', { message: 'Token ausente' });
            }
            try {
                const decoded = authService.verifyAccessToken(token, 'user');
                const viewer = await userModel.findById(decoded.subjectId).select('_id isBlocked');
                if (!viewer || viewer.isBlocked) {
                    return socket.emit('unauthorized', { message: 'Usuário inválido' });
                }
                await bindSocketIdentity(socket, {
                    decoded,
                    actorType: 'user',
                    actorId: decoded.subjectId,
                    token,
                    deviceId,
                });
                socket.join('map-viewers');
            } catch (err) {
                socket.emit('unauthorized', { message: 'Token inválido' });
            }
        });

        socket.on('unsubscribe-drivers-map', () => {
            socket.leave('map-viewers');
        });

        // A10 da auditoria de push (2026-08-02): antes, qualquer socket conectado
        // entrava em `chat_<rideId>` só sabendo o id da corrida — sem provar quem era —
        // e passava a receber (e podia forjar o envio de) mensagens de uma conversa
        // alheia entre passageiro e motorista. Agora 'join-chat' exige o JWT de quem
        // está entrando e confirma que essa identidade é o `user` ou o `captain` da
        // corrida antes de autorizar. A autorização fica em `socket.data` (memória do
        // próprio socket, não persiste em nada) pra não repetir a consulta ao banco em
        // cada mensagem/typing — só uma vez por entrada na sala.
        const resolveChatIdentity = async (token) => {
            if (!token) return null;
            try {
                const decoded = authService.verifyAccessToken(token, ['user', 'captain']);
                if (decoded.actorType === 'user') {
                    const account = await userModel.findById(decoded.subjectId).select('_id isBlocked');
                    if (account && !account.isBlocked) {
                        return { type: 'user', id: account._id.toString(), decoded };
                    }
                    return null;
                }
                if (decoded.actorType === 'captain') {
                    const account = await captainModel.findById(decoded.subjectId).select('_id isBlocked');
                    if (account && !account.isBlocked) {
                        return { type: 'captain', id: account._id.toString(), decoded };
                    }
                    return null;
                }

                // Compatibilidade temporária: tokens legados não carregam ator. Só
                // durante a janela explícita de migração ainda é necessário descobrir
                // a coleção, preservando o comportamento anterior até expirarem.
                const legacyUser = await userModel.findById(decoded.subjectId).select('_id isBlocked');
                if (legacyUser && !legacyUser.isBlocked) {
                    return { type: 'user', id: legacyUser._id.toString(), decoded };
                }
                const legacyCaptain = await captainModel.findById(decoded.subjectId).select('_id isBlocked');
                if (legacyCaptain && !legacyCaptain.isBlocked) {
                    return { type: 'captain', id: legacyCaptain._id.toString(), decoded };
                }
            } catch (err) {
                return null;
            }
            return null;
        };

        const canAccessChat = async (identity, { subjectType, subjectId, rideId } = {}) => {
            const key = chatRoomKey({ subjectType, subjectId, rideId });
            if (!identity || !key) return false;

            if (subjectType === 'parcel') {
                const parcel = await parcelModel.findById(subjectId || rideId).select('user captain');
                if (!parcel) return false;
                if (identity.type === 'user' && parcel.user) return parcel.user.toString() === identity.id;
                if (identity.type === 'captain' && parcel.captain) return parcel.captain.toString() === identity.id;
                return false;
            }

            const ride = await rideModel.findById(subjectId || rideId).select('user captain');
            if (!ride) return false;
            if (identity.type === 'user' && ride.user) return ride.user.toString() === identity.id;
            if (identity.type === 'captain' && ride.captain) return ride.captain.toString() === identity.id;
            return false;
        };

        const hasChatAccess = (key) => !!(key && socket.data.authorizedChats && socket.data.authorizedChats.has(key));

        const hasLiveChatAccess = async (key) => {
            if (!hasChatAccess(key)) return false;
            const chatIdentity = socket.data.chatIdentities?.get(key);
            if (!chatIdentity) return false;
            return revalidateSocketIdentity(socket, chatIdentity.type);
        };

        socket.on('join-chat', async (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const subjectId = data?.subjectId || data?.rideId;
            const rideId = data?.rideId || (subjectType === 'ride' ? subjectId : undefined);
            const key = chatRoomKey({ subjectType, subjectId, rideId });
            const token = data?.token;
            if (!key) return;

            const identity = await resolveChatIdentity(token);
            const allowed = await canAccessChat(identity, { subjectType, subjectId, rideId });
            if (!allowed) {
                console.log(`[AUDIT] JOIN em ${chatRoomName(key)} rejeitado (sem acesso) no socket ${socket.id}`);
                return socket.emit('unauthorized', { message: 'Sem acesso a este chat' });
            }

            try {
                await bindSocketIdentity(socket, {
                    decoded: identity.decoded,
                    actorType: identity.type,
                    actorId: identity.id,
                    token,
                    deviceId: data?.deviceId,
                });
            } catch (error) {
                return socket.emit('unauthorized', { message: 'Sessão do chat inválida' });
            }

            if (!socket.data.authorizedChats) socket.data.authorizedChats = new Set();
            if (!socket.data.chatIdentities) socket.data.chatIdentities = new Map();
            if (!socket.data.chatSubjects) socket.data.chatSubjects = new Map();
            const wasAuthorized = socket.data.authorizedChats.has(key);
            socket.data.authorizedChats.add(key);
            socket.data.chatIdentities.set(key, { type: identity.type, id: identity.id });
            socket.data.chatSubjects.set(key, { subjectType, subjectId: (subjectId || '').toString(), rideId: rideId?.toString?.() });
            socket.join(chatRoomName(key));
            if (!wasAuthorized) addChatPresence(key, identity.type);
        });

        socket.on('leave-chat', (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const subjectId = data?.subjectId || data?.rideId;
            const key = chatRoomKey({ subjectType, subjectId, rideId: data?.rideId });
            if (key) {
                socket.leave(chatRoomName(key));
                const identity = socket.data.chatIdentities?.get(key);
                if (identity) removeChatPresence(key, identity.type);
                socket.data.authorizedChats?.delete(key);
                socket.data.chatIdentities?.delete(key);
                socket.data.chatSubjects?.delete(key);
            }
        });

        socket.on('send-message', async (data, ack) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const subjectId = data?.subjectId || data?.rideId;
            const rideId = data?.rideId || (subjectType === 'ride' ? subjectId : undefined);
            const key = chatRoomKey({ subjectType, subjectId, rideId });
            // Compatibilidade com clientes antigos: a mensagem já foi persistida e
            // publicada pelo POST /chat/send. Não retransmitimos payload vindo do
            // cliente, pois isso duplicava eventos/push e permitia forjar mensagens.
            if (typeof ack === 'function') {
                ack({ ok: await hasLiveChatAccess(key), relayedBy: 'http' });
            }
        });

        socket.on('message-delivered', async (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { messageId } = data || {};
            if (await hasLiveChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('message-delivered', { messageId });
            }
        });

        socket.on('message-read', async (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { messageId } = data || {};
            if (await hasLiveChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('message-read', { messageId });
            }
        });

        socket.on('typing-start', async (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { senderType } = data || {};
            if (await hasLiveChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('typing-start', { senderType });
            }
        });

        socket.on('typing-stop', async (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { senderType } = data || {};
            if (await hasLiveChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('typing-stop', { senderType });
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[AUDIT] Client disconnected: ${socket.id}`);
            // Remove presença, registro por JTI/dispositivo e somente substitui o
            // socketId legado se este era o ponteiro atual. Outra aba ativa assume o
            // ponteiro, em vez de ser apagada pelo disconnect da aba mais recente.
            await releaseSocketIdentity(socket, 'transport_disconnect');
        });
    });

    return io;
}

const sendMessageToSocketId = (socketId, messageObject) => {
    console.log(`[AUDIT] Socket emit '${messageObject.event}' para socketId: ${socketId}`);

    if (io) {
        const target = io.sockets.sockets.get(socketId);
        const identity = target?.data?.identity;
        const destination = identity ? actorRoom(identity.type, identity.id) : socketId;
        io.to(destination).emit(messageObject.event, messageObject.data);
    } else {
        console.log('[AUDIT] ERROR: Socket.io not initialized.');
    }
}

const addSocketToRoom = (socketId, roomName) => {
    console.log(`[AUDIT] Adicionando socketId ${socketId} à sala ${roomName}`);
    if (io) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            const identity = socket.data?.identity;
            const actorSocketIds = identity
                ? io.sockets.adapter.rooms.get(actorRoom(identity.type, identity.id)) || new Set([socketId])
                : new Set([socketId]);
            for (const actorSocketId of actorSocketIds) {
                io.sockets.sockets.get(actorSocketId)?.join(roomName);
            }
            console.log(`[AUDIT] ${actorSocketIds.size} socket(s) do ator entraram na sala ${roomName}`);
        } else {
            console.log(`[AUDIT] ERROR: Socket ${socketId} não encontrado no momento do JOIN na sala ${roomName}`);
        }
    }
}

const sendMessageToRoom = (roomName, messageObject) => {
    if (io) {
        io.to(roomName).emit(messageObject.event, messageObject.data);
    } else {
        console.log('Socket.io not initialized.');
    }
}

// Último estado que a sala 'map-viewers' já recebeu de cada motorista. Existe para não
// repetir informação: o cliente manda posição a cada 5–10s, mas o mapa do passageiro só
// precisa saber quando algo MUDA (ficou ocupado, voltou a ficar livre) ou quando o
// motorista de fato andou. Uma entrada por motorista ativo, liberada no toggle offline.
const driverMapState = new Map();
const DRIVER_LOCATION_MIN_INTERVAL_MS = 4000;

const emitDriverMapUpdate = (driverId, { busy, vehicleType, vehicleAuthorization, location }) => {
    if (!io) return;
    const key = String(driverId);
    const previous = driverMapState.get(key);

    if (busy) {
        if (previous && previous.busy) return;
        driverMapState.set(key, { busy: true, lastEmitAt: Date.now() });
        io.to('map-viewers').emit('driver-busy', { driverId: key });
        return;
    }

    // Voltar de ocupado para disponível é uma mudança de estado: emite na hora, sem
    // esperar a janela do throttle (senão o motorista demoraria a reaparecer no mapa).
    const becameAvailable = !previous || previous.busy;
    if (!becameAvailable && Date.now() - previous.lastEmitAt < DRIVER_LOCATION_MIN_INTERVAL_MS) return;

    driverMapState.set(key, { busy: false, lastEmitAt: Date.now() });
    io.to('map-viewers').emit('driver-location', { driverId: key, vehicleType, vehicleAuthorization, location });
}

// Chamado quando o motorista sai do ar ou é liberado de uma corrida: esquece o último
// estado para que o próximo evento seja emitido imediatamente, sem cair no throttle nem
// na deduplicação de 'driver-busy'.
const clearDriverMapState = (driverId) => {
    driverMapState.delete(String(driverId));
}

// P3.2 da auditoria de concorrência (2026-08-02): usado no bloqueio administrativo de
// usuário/motorista — sem derrubar o socket ativo, a pessoa bloqueada continua recebendo
// eventos em tempo real (inclusive novas corridas, se for motorista) até fechar o app
// sozinha, mesmo com o token já rejeitado nas próximas chamadas HTTP.
const disconnectSocket = (socketId) => {
    if (!io || !socketId) return;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
        console.log(`[AUDIT] Desconectando socketId ${socketId} (bloqueio administrativo)`);
        socket.disconnect(true);
    }
}

module.exports = {
    initializeSocket,
    sendMessageToSocketId,
    addSocketToRoom,
    sendMessageToRoom,
    publishPersistedChatMessage,
    disconnectSocket,
    emitDriverMapUpdate,
    clearDriverMapState,
    actorRoom,
    bindSocketIdentity,
    revalidateSocketIdentity,
    disconnectRevokedSockets,
    eventTargetsIdentity,
};
