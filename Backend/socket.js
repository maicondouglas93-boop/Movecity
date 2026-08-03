const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const rideModel = require('./models/ride.model');
const adminUserModel = require('./models/adminUser.model');
const mapService = require('./services/maps.service');
const notificationDispatcher = require('./notification/notificationDispatcher.service');

let io;

// A7 da auditoria de push (2026-08-02): "quem está de fato olhando este chat agora" —
// contagem por corrida e por tipo (não por socket, pra suportar a mesma pessoa com duas
// abas/dispositivos abertos sem que sair de uma derrube a presença da outra). Usado por
// 'send-message' pra decidir: destinatário presente -> só Socket.IO (como já era);
// destinatário ausente -> cai pro push (antes não existia nenhum aviso nesse caso).
const chatPresence = new Map(); // rideId (string) -> { user: number, captain: number }

const addChatPresence = (rideId, type) => {
    if (!chatPresence.has(rideId)) chatPresence.set(rideId, { user: 0, captain: 0 });
    chatPresence.get(rideId)[type]++;
};

const removeChatPresence = (rideId, type) => {
    const presence = chatPresence.get(rideId);
    if (!presence) return;
    presence[type] = Math.max(0, presence[type] - 1);
    if (presence.user === 0 && presence.captain === 0) chatPresence.delete(rideId);
};

const isChatPresent = (rideId, type) => (chatPresence.get(rideId)?.[type] || 0) > 0;

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

            await captainModel.findByIdAndUpdate(userId, {
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
            });

            // Find active ride for this captain and emit update to the rider
            const ride = await rideModel.findOne({
                captain: userId,
                status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing' ] }
            }).populate('user');

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
                        actualDistance: currentDistance
                    });
                }
                // Also send back to the captain's socket to update their local map in real time
                socket.emit('captain-location-updated', {
                    ltd: location.ltd,
                    lng: location.lng,
                    actualDistance: currentDistance
                });
            }

            io.to('admin_room').emit('admin-captain-location-updated', {
                captainId: userId,
                ltd: location.ltd,
                lng: location.lng,
            });
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

        const canAccessChat = async (identity, rideId) => {
            if (!identity || !rideId) return false;
            const ride = await rideModel.findById(rideId).select('user captain');
            if (!ride) return false;
            if (identity.type === 'user' && ride.user) return ride.user.toString() === identity.id;
            if (identity.type === 'captain' && ride.captain) return ride.captain.toString() === identity.id;
            return false;
        };

        const hasChatAccess = (rideId) => !!(rideId && socket.data.authorizedChats && socket.data.authorizedChats.has(rideId));

        socket.on('join-chat', async (data) => {
            const { rideId, token } = data || {};
            if (!rideId) return;

            const identity = await resolveChatIdentity(token);
            const allowed = await canAccessChat(identity, rideId);
            if (!allowed) {
                console.log(`[AUDIT] JOIN em chat_${rideId} rejeitado (sem acesso) no socket ${socket.id}`);
                return socket.emit('unauthorized', { message: 'Sem acesso a este chat' });
            }

            if (!socket.data.authorizedChats) socket.data.authorizedChats = new Set();
            if (!socket.data.chatIdentities) socket.data.chatIdentities = new Map();
            socket.data.authorizedChats.add(rideId);
            socket.data.chatIdentities.set(rideId, identity);
            socket.join(`chat_${rideId}`);
            addChatPresence(rideId, identity.type);
        });

        socket.on('leave-chat', (data) => {
            const { rideId } = data || {};
            if (rideId) {
                socket.leave(`chat_${rideId}`);
                const identity = socket.data.chatIdentities?.get(rideId);
                if (identity) removeChatPresence(rideId, identity.type);
                socket.data.authorizedChats?.delete(rideId);
                socket.data.chatIdentities?.delete(rideId);
            }
        });

        socket.on('send-message', async (data) => {
            const { rideId, message } = data || {};
            if (!hasChatAccess(rideId)) return;

            socket.to(`chat_${rideId}`).emit('receive-message', message);

            // A7 da auditoria de push (2026-08-02): "App aberto -> Socket.IO; App
            // fechado -> Firebase Push". O relay acima já cobre o primeiro caso; isto
            // aqui cobre o segundo, que antes simplesmente não existia — quem não
            // estava com o chat aberto nunca sabia que recebeu uma mensagem.
            try {
                const senderIdentity = socket.data.chatIdentities?.get(rideId);
                if (!senderIdentity) return;

                const recipientType = senderIdentity.type === 'user' ? 'captain' : 'user';
                if (isChatPresent(rideId, recipientType)) return;

                const ride = await rideModel.findById(rideId).select('user captain');
                if (!ride) return;

                const preview = typeof message?.message === 'string' ? message.message.slice(0, 100) : 'Nova mensagem';
                if (recipientType === 'captain' && ride.captain) {
                    notificationDispatcher.sendChatMessageToCaptain(ride.captain, preview, { rideId }).catch(err => console.error('[Chat Push]', err.message));
                } else if (recipientType === 'user' && ride.user) {
                    notificationDispatcher.sendChatMessageToUser(ride.user, preview, { rideId }).catch(err => console.error('[Chat Push]', err.message));
                }
            } catch (err) {
                console.error('[Chat Push] Erro ao processar fallback de push:', err.message);
            }
        });

        socket.on('message-delivered', (data) => {
            const { rideId, messageId } = data || {};
            if (hasChatAccess(rideId)) {
                socket.to(`chat_${rideId}`).emit('message-delivered', { messageId });
            }
        });

        socket.on('message-read', (data) => {
            const { rideId, messageId } = data || {};
            if (hasChatAccess(rideId)) {
                socket.to(`chat_${rideId}`).emit('message-read', { messageId });
            }
        });

        socket.on('typing-start', (data) => {
            const { rideId, senderType } = data || {};
            if (hasChatAccess(rideId)) {
                socket.to(`chat_${rideId}`).emit('typing-start', { senderType });
            }
        });

        socket.on('typing-stop', (data) => {
            const { rideId, senderType } = data || {};
            if (hasChatAccess(rideId)) {
                socket.to(`chat_${rideId}`).emit('typing-stop', { senderType });
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[AUDIT] Client disconnected: ${socket.id}`);

            // A7: sem isto, um socket que caiu sem emitir 'leave-chat' (fechar o app,
            // perder conexão) deixaria a presença de chat "presa" achando que ele ainda
            // está olhando a tela — e o outro lado nunca mais receberia push nenhum.
            if (socket.data.chatIdentities) {
                for (const [rideId, identity] of socket.data.chatIdentities.entries()) {
                    removeChatPresence(rideId, identity.type);
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

module.exports = { initializeSocket, sendMessageToSocketId, addSocketToRoom, sendMessageToRoom, disconnectSocket };