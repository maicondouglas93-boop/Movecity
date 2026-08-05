const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const rideModel = require('./models/ride.model');
const parcelModel = require('./models/parcel.model');
const adminUserModel = require('./models/adminUser.model');
const mapService = require('./services/maps.service');
const notificationDispatcher = require('./notification/notificationDispatcher.service');

let io;

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
    const allowedOrigins = [
        "http://localhost:5173",
        process.env.FRONTEND_URL
    ];

    io = socketIo(server, {
        transports: [ 'websocket', 'polling' ],
        cors: {
            origin: allowedOrigins,
            methods: [ 'GET', 'POST' ],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log(`[AUDIT] Client connected: ${socket.id}`);

        socket.on('join', async (data, ack) => {
            const { userId, userType, token } = data;
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
                    decoded = jwt.verify(token, process.env.JWT_SECRET);
                } catch (err) {
                    console.log(`[AUDIT] JOIN ${userType} rejeitado (token inválido) no socket ${socket.id}`);
                    return reject('Token inválido');
                }
                const authenticatedId = decoded._id;

                if (userType === 'user') {
                    const user = await userModel.findById(authenticatedId);
                    if (!user || user.isBlocked) {
                        console.log(`[AUDIT] JOIN user rejeitado (inválido/bloqueado) no socket ${socket.id}`);
                        return reject('Usuário inválido');
                    }
                    socket.data.identity = { type: 'user', id: authenticatedId };
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
                    socket.data.identity = { type: 'captain', id: authenticatedId };

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
                const { token } = data;
                if (!token) {
                    console.log(`[AUDIT] JOIN admin rejeitado (sem token) no socket ${socket.id}`);
                    return reject('Token de admin ausente');
                }
                try {
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    const admin = await adminUserModel.findById(decoded._id);
                    if (!admin || !admin.active) {
                        console.log(`[AUDIT] JOIN admin rejeitado (inativo/inexistente) no socket ${socket.id}`);
                        return reject('Admin inválido');
                    }
                    socket.join('admin_room');
                    console.log(`[AUDIT] Admin ${admin.email} entrou em admin_room via socket ${socket.id}`);
                } catch (err) {
                    console.log(`[AUDIT] JOIN admin rejeitado (token inválido) no socket ${socket.id}`);
                    return reject('Token de admin inválido');
                }
            }

            if (typeof ack === 'function') ack({ ok: true });
        });


        socket.on('update-location-captain', async (data) => {
            // Auditoria PWA (2026-08-03, C1): antes, `userId` vinha do payload do
            // cliente sem nenhuma verificação — qualquer socket conectado (nem
            // precisava ter feito join) podia falsificar a localização de QUALQUER
            // motorista, o que também contamina `actualDistance` (usada no cálculo de
            // tarifa) de uma corrida real em andamento. Agora só aceita a localização
            // do motorista que passou pelo `join` autenticado nesta mesma conexão.
            if (!socket.data.identity || socket.data.identity.type !== 'captain') {
                console.log(`[AUDIT] update-location-captain rejeitado (sem identidade de captain autenticada) no socket ${socket.id}`);
                return socket.emit('unauthorized', { message: 'Não autenticado' });
            }
            const userId = socket.data.identity.id;
            const { location } = data;

            if (!location || location.ltd == null || location.lng == null) {
                return socket.emit('error', { message: 'Invalid location data' });
            }

            // Fase C (2026-08-03): `{ new: true }` pra ter o doc atualizado em mãos —
            // o broadcast pro mapa do passageiro (abaixo) precisa de vehicle/isOnline
            // sem uma segunda query.
            const captainDoc = await captainModel.findByIdAndUpdate(userId, {
                location: {
                    ltd: location.ltd,
                    lng: location.lng
                },
                locationGeoJSON: {
                    type: 'Point',
                    coordinates: [location.lng, location.ltd]
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

            if (ride) {
                let currentDistance = ride.actualDistance || 0;
                
                if (ride.status === 'started' || ride.status === 'ongoing') {
                    if (ride.lastLocation && ride.lastLocation.lat && ride.lastLocation.lng) {
                        const distKm = mapService.haversineKm(ride.lastLocation.lat, ride.lastLocation.lng, location.ltd, location.lng);
                        const distMeters = distKm * 1000;
                        
                        // Filtro de Precisão (GPS accuracy filter)
                        // Ignore jumps > 2000m (2km) - likely a glitch
                        // Ignore jumps < 5m - likely standing still and GPS drifting
                        if (distMeters > 5 && distMeters < 2000) {
                            currentDistance += distMeters;
                            // Update distance and location only when valid movement occurred
                            await rideModel.findByIdAndUpdate(ride._id, {
                                actualDistance: currentDistance,
                                lastLocation: { lat: location.ltd, lng: location.lng }
                            });
                        }
                    } else {
                        // First time saving location after ride started
                        await rideModel.findByIdAndUpdate(ride._id, {
                            lastLocation: { lat: location.ltd, lng: location.lng }
                        });
                    }
                }

                if (ride.user && ride.user.socketId) {
                    io.to(ride.user.socketId).emit('captain-location-updated', {
                        ltd: location.ltd,
                        lng: location.lng,
                        actualDistance: currentDistance,
                        rideId: ride._id.toString(),
                    });
                }
                // Also send back to the captain's socket to update their local map in real time
                socket.emit('captain-location-updated', {
                    ltd: location.ltd,
                    lng: location.lng,
                    actualDistance: currentDistance,
                    rideId: ride._id.toString(),
                });
            } else if (parcel) {
                const locPayload = {
                    ltd: location.ltd,
                    lng: location.lng,
                    parcelId: parcel._id.toString(),
                    subjectType: 'parcel',
                };
                if (parcel.user && parcel.user.socketId) {
                    io.to(parcel.user.socketId).emit('captain-location-updated', locPayload);
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
                ltd: location.ltd,
                lng: location.lng,
                name: `${adminFirst} ${adminLast}`.trim() || 'Motorista',
                status: adminInRide ? 'in_ride' : 'available',
                vehicle: captainDoc?.vehicle ? {
                    plate: captainDoc.vehicle.plate || '',
                    vehicleType: captainDoc.vehicle.vehicleType || '',
                    color: captainDoc.vehicle.color || '',
                    modelo: captainDoc.vehicle.modelo || '',
                } : null,
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
                emitDriverMapUpdate(userId, {
                    busy: false,
                    vehicleType: captainDoc.vehicle?.vehicleType || 'car',
                    location: { ltd: location.ltd, lng: location.lng }
                });
            }
        });

        // Fase C (2026-08-03): entrada na sala que recebe os motoristas disponíveis em
        // tempo real. Exige o JWT do passageiro no próprio evento (mesmo padrão do
        // join-chat) em vez de depender da ordem do 'join' — e porque posição de frota
        // é dado sensível: sem essa checagem, qualquer socket anônimo poderia assistir
        // a localização de todos os motoristas online.
        socket.on('subscribe-drivers-map', async (data) => {
            const { token } = data || {};
            if (!token) {
                return socket.emit('unauthorized', { message: 'Token ausente' });
            }
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const viewer = await userModel.findById(decoded._id).select('_id isBlocked');
                if (!viewer || viewer.isBlocked) {
                    return socket.emit('unauthorized', { message: 'Usuário inválido' });
                }
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
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const identifiedUser = await userModel.findById(decoded._id).select('_id');
                if (identifiedUser) return { type: 'user', id: identifiedUser._id.toString() };
                const identifiedCaptain = await captainModel.findById(decoded._id).select('_id');
                if (identifiedCaptain) return { type: 'captain', id: identifiedCaptain._id.toString() };
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

            if (!socket.data.authorizedChats) socket.data.authorizedChats = new Set();
            if (!socket.data.chatIdentities) socket.data.chatIdentities = new Map();
            if (!socket.data.chatSubjects) socket.data.chatSubjects = new Map();
            socket.data.authorizedChats.add(key);
            socket.data.chatIdentities.set(key, identity);
            socket.data.chatSubjects.set(key, { subjectType, subjectId: (subjectId || '').toString(), rideId: rideId?.toString?.() });
            socket.join(chatRoomName(key));
            addChatPresence(key, identity.type);
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
                ack({ ok: hasChatAccess(key), relayedBy: 'http' });
            }
        });

        socket.on('message-delivered', (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { messageId } = data || {};
            if (hasChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('message-delivered', { messageId });
            }
        });

        socket.on('message-read', (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { messageId } = data || {};
            if (hasChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('message-read', { messageId });
            }
        });

        socket.on('typing-start', (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { senderType } = data || {};
            if (hasChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('typing-start', { senderType });
            }
        });

        socket.on('typing-stop', (data) => {
            const subjectType = data?.subjectType === 'parcel' ? 'parcel' : 'ride';
            const key = chatRoomKey({ subjectType, subjectId: data?.subjectId || data?.rideId, rideId: data?.rideId });
            const { senderType } = data || {};
            if (hasChatAccess(key)) {
                socket.to(chatRoomName(key)).emit('typing-stop', { senderType });
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[AUDIT] Client disconnected: ${socket.id}`);

            // A7: sem isto, um socket que caiu sem emitir 'leave-chat' (fechar o app,
            // perder conexão) deixaria a presença de chat "presa" achando que ele ainda
            // está olhando a tela — e o outro lado nunca mais receberia push nenhum.
            if (socket.data.chatIdentities) {
                for (const [key, identity] of socket.data.chatIdentities.entries()) {
                    removeChatPresence(key, identity.type);
                }
            }

            await userModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });

            // findOneAndUpdate sem { new: true } retorna o documento ANTES do update,
            // então dá pra saber se esse motorista estava online quando desconectou.
            const captainBeforeUpdate = await captainModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
            if (captainBeforeUpdate && captainBeforeUpdate.isOnline) {
                // Separação disponibilidade x conexão (2026-08-03): o tempo online mede
                // tempo realmente CONECTADO, então a sessão é fechada aqui como sempre
                // foi — sem isso ela contaria para sempre.
                //
                // O que MUDOU: `isOnline` não é mais zerado. Ele passou a significar só a
                // intenção do motorista ("quero receber corridas"), e fechar o app não é
                // desistir de receber corridas. Zerá-lo aqui era exatamente o que tirava
                // o motorista do despacho ao fechar o app e tornava a push de corrida
                // nova inalcançável. Quem cuida de "sumiu de vez" agora é o TTL de
                // lastSeenAt em captainService.availabilityFilter().
                const captainService = require('./services/captain.service');
                await captainService.endOnlineSession(captainBeforeUpdate._id);

                const { deleteByPrefix } = require('./cache/cache');
                deleteByPrefix(`profile:captain:${captainBeforeUpdate._id}`);
                deleteByPrefix('drivers:');
            }
        });
    });
}

const sendMessageToSocketId = (socketId, messageObject) => {
    console.log(`[AUDIT] Socket emit '${messageObject.event}' para socketId: ${socketId}`);

    if (io) {
        io.to(socketId).emit(messageObject.event, messageObject.data);
    } else {
        console.log('[AUDIT] ERROR: Socket.io not initialized.');
    }
}

const addSocketToRoom = (socketId, roomName) => {
    console.log(`[AUDIT] Adicionando socketId ${socketId} à sala ${roomName}`);
    if (io) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.join(roomName);
            console.log(`[AUDIT] socketId ${socketId} entrou na sala ${roomName} com sucesso`);
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

const emitDriverMapUpdate = (driverId, { busy, vehicleType, location }) => {
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
    io.to('map-viewers').emit('driver-location', { driverId: key, vehicleType, location });
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
};