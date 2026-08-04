const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const { sendMessageToSocketId, addSocketToRoom, sendMessageToRoom, emitDriverMapUpdate } = require('../socket');
const rideModel = require('../models/ride.model');
const { getCache, setCache, deleteCache, deleteByPrefix } = require('../cache/cache');
const notificationService = require('../services/notification.service');


// Busca motoristas compatíveis no raio de despacho e emite 'new-ride' para cada um.
// Extraído de createRide (auditoria de UX do motorista, 2026-08-02) para ser reaproveitado
// por captainCancelRide — quando um motorista desiste de uma corrida já aceita, ela
// precisa ser redespachada exatamente da mesma forma que uma corrida recém-criada,
// exceto que o motorista que acabou de desistir não deve ser candidato de novo.
// Exportada além de usada internamente (Bloco E da auditoria administrativa, 2026-08-02):
// a reatribuição de corrida pelo painel admin precisa do mesmo redespacho — sem isso,
// a corrida voltava a 'requested' mas nenhum motorista era notificado, ficando travada.
async function dispatchRideToCaptains(ride, { pickup, vehicleType, TRACE_ID, excludeCaptainId } = {}) {
    const pickupCoordinates = await mapService.getAddressCoordinate(pickup);
    // 15km: raio de busca de motoristas a partir do ponto de embarque.
    const CAPTAIN_SEARCH_RADIUS_KM = 15;
    const captainsInRadius = await mapService.getCaptainsInTheRadius(pickupCoordinates.ltd, pickupCoordinates.lng, CAPTAIN_SEARCH_RADIUS_KM, TRACE_ID);

    console.log(`[AUDIT][${TRACE_ID}] Pickup Coords:`, pickupCoordinates);
    console.log(`[AUDIT][${TRACE_ID}] Captains no raio inicial:`, captainsInRadius.length);

    const matchingCaptains = captainsInRadius.filter(captain => {
        if (excludeCaptainId && captain._id.toString() === excludeCaptainId.toString()) {
            return false;
        }
        if (!captain.vehicle || !captain.vehicle.vehicleType) {
            console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (Sem veículo definido)`);
            return false;
        }
        const capType = captain.vehicle.vehicleType;
        const isMatch = capType === vehicleType;

        if (!isMatch) {
            console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (Veículo incompatível: ${capType} != ${vehicleType})`);
        } else {
            console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} aprovado para receber!`);
        }
        return isMatch;
    });

    console.log(`[AUDIT][${TRACE_ID}] Matching Captains finais:`, matchingCaptains.length);

    // Persiste as coordenadas do embarque na própria corrida (Etapa 6 da auditoria de UX,
    // 2026-08-02) — o frontend usa isso pra mostrar a distância até o passageiro no popup
    // de oferta, calculada localmente a partir da posição GPS do motorista.
    const rideWithUser = await rideModel.findOneAndUpdate(
        { _id: ride._id },
        { pickupCoordinates: { lat: pickupCoordinates.ltd, lng: pickupCoordinates.lng } },
        { new: true }
    ).populate('user');

    matchingCaptains.forEach(captain => {
        // Put captain in a room for this specific ride
        addSocketToRoom(captain.socketId, `ride_${ride._id}`);

        console.log(`[AUDIT][${TRACE_ID}] Emitindo 'new-ride' para socketId ${captain.socketId} (Captain: ${captain._id})`);
        sendMessageToSocketId(captain.socketId, {
            event: 'new-ride',
            data: rideWithUser
        });
        // C5 da auditoria de push (2026-08-02): disparado sem await de propósito (não
        // atrasar o despacho da corrida), mas sem .catch() uma falha aqui virava unhandled
        // rejection capaz de derrubar o processo — o service já tem try/catch interno
        // desde a mesma auditoria, isto é defesa em profundidade.
        // Diagnóstico de push de corrida (2026-08-03): fare vai junto pra sendNewRide
        // conseguir montar "Passageiro próximo • R$ XX,XX" — antes só o rideId era
        // passado, mesmo o valor já existindo no documento da corrida.
        notificationService.sendNewRide(captain._id, { rideId: ride._id.toString(), fare: ride.fare }, TRACE_ID).catch(console.error);
    });

    return matchingCaptains.length;
}

module.exports.createRide = async (req, res) => {
    console.log(`[AUDIT] /rides/create HIT. Body:`, req.body);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log(`[AUDIT] /rides/create Validation Errors:`, errors.array());
        return res.status(400).json({ errors: errors.array() });
    }

    const { userId, pickup, destination, vehicleType, paymentMethod, optionals, observation, useWalletBalance, requestFemaleDriver, promoCode } = req.body;

    try {
        if (!req.user || !req.user._id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        // Bloco H (2026-08-02): createRide agora devolve { ride, promoError } — um cupom
        // inválido não impede a corrida de ser criada, só não aplica desconto; o motivo
        // vai junto na resposta pro app do passageiro decidir como avisar.
        const { ride, promoError } = await rideService.createRide({
            user: req.user._id,
            pickup,
            destination,
            vehicleType,
            paymentMethod,
            optionals,
            observation,
            useWalletBalance,
            requestFemaleDriver,
            promoCode
        });

        const TRACE_ID = `Ride:${ride._id}`;
        console.log(`[AUDIT][${TRACE_ID}] Corrida criada no DB para usuário ${req.user._id}`);

        await dispatchRideToCaptains(ride, { pickup, vehicleType, TRACE_ID });

        // Invalidate dashboard and user history cache
        deleteCache('dashboard:today');
        deleteByPrefix(`history:${req.user._id}`);

        res.status(201).json({ ...ride.toObject(), promoError });

    } catch (err) {
        console.error(`[AUDIT] Erro crítico no createRide:`, err);
        return res.status(500).json({ message: err.message });
    }

};

module.exports.getFare = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { pickup, destination } = req.query;

    try {
        const fare = await rideService.getFare(pickup, destination);
        return res.status(200).json(fare);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// Único caminho de aceite (P1.3 da auditoria de concorrência, 2026-08-01) — usado por
// POST /rides/confirm (rideId no body) e POST /rides/:id/accept (rideId na URL), que
// antes tinham implementações diferentes: /confirm sobrescrevia sem checar status,
// permitindo dois motoristas "vencerem" a mesma corrida. Ambas as rotas agora chamam
// exatamente a mesma lógica atômica.
async function performAcceptRide(rideId, captain, res) {
    const TRACE_ID = `Ride:${rideId}`;
    try {
        console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} tentando aceitar a corrida.`);
        const ride = await rideService.acceptRideAtomic({ rideId, captain });
        console.log(`[AUDIT][${TRACE_ID}] Corrida aceita com sucesso pelo Captain ${captain._id}.`);

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-confirmed',
            data: ride
        });

        notificationService.sendRideAccepted(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);

        // Avisa os outros motoristas que estavam com essa corrida na tela que ela já foi
        // aceita por outro colega — fecha o popup deles (listener entra na Etapa P3.1).
        // Correção crítica do aceite (2026-08-03): a sala ride_<id> inclui TODOS os
        // candidatos do despacho — inclusive quem acabou de vencer o aceite atômico.
        // `captainId` diz quem venceu, para o frontend do vencedor ignorar o evento em
        // vez de mostrar "aceita por outro motorista" para o próprio dono da corrida.
        sendMessageToRoom(`ride_${rideId}`, {
            event: 'ride-taken',
            data: { rideId, captainId: captain._id.toString() }
        });

        // Fase C (2026-08-03): o motorista aceitou — sai imediatamente do mapa dos
        // passageiros que observam motoristas disponíveis. Sem isto, ele só sumiria no
        // próximo update de localização (~10s), aparecendo como "livre" sem estar.
        emitDriverMapUpdate(captain._id, { busy: true });

        // Delete otp from response sent to captain for security
        const rideForCaptain = ride.toObject();
        delete rideForCaptain.otp;

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(rideForCaptain);
    } catch (err) {
        console.error(`[AUDIT][${TRACE_ID}] Falha ao aceitar corrida (Concorrência ou Erro):`, err.message);
        // Diagnóstico de push de corrida (2026-08-03), achado 4: antes, cancelada pelo
        // passageiro caía no mesmo 409 de "outro motorista aceitou" — mensagem
        // factualmente errada pro motorista quando a causa real era cancelamento.
        if (err.message === 'RIDE_CANCELLED') {
            return res.status(409).json({ message: 'O passageiro cancelou esta corrida.' });
        }
        if (err.message === 'RIDE_ALREADY_ACCEPTED') {
            return res.status(409).json({ message: 'Corrida já aceita por outro motorista' });
        }
        if (err.message === 'RIDE_NOT_FOUND') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'CAPTAIN_ALREADY_HAS_ACTIVE_RIDE') {
            return res.status(409).json({ message: 'Você já está em outra corrida ativa.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;
    return performAcceptRide(rideId, req.captain, res);
}

module.exports.acceptRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id: rideId } = req.params;
    return performAcceptRide(rideId, req.captain, res);
}

module.exports.startRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, otp } = req.query;

    try {
        const ride = await rideService.startRide({ rideId, otp, captain: req.captain });

        console.log(ride);

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-started',
            data: ride
        })
        notificationService.sendRideStarted(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride not accepted') {
            return res.status(409).json({ message: 'Corrida não está mais num estado que permita iniciar (pode ter sido cancelada).' });
        }
        if (err.message === 'Invalid OTP') {
            return res.status(400).json({ message: 'PIN inválido.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.updateRideStatus = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, status } = req.body;

    try {
        const ride = await rideService.updateRideStatus({ rideId, captain: req.captain, status });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-status-updated',
            data: ride
        })

        // A5 da auditoria de push (2026-08-02): "motorista chegou" é justamente o
        // momento em que o passageiro mais provavelmente NÃO está com o app aberto —
        // socket sozinho não alcança quem não está olhando a tela.
        if (status === 'arrived' && ride.user?._id) {
            notificationService.sendCaptainArrived(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);
        }

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        if (err.message === 'Invalid status') {
            return res.status(400).json({ message: 'Status inválido para esta ação.' });
        }
        if (err.message === 'Ride not found or invalid transition') {
            return res.status(409).json({ message: 'Corrida não encontrada ou não está mais num estado que permita essa mudança.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// Fase C (2026-08-03): o motorista volta ao mapa dos passageiros assim que é liberado da
// corrida. Sem isto ele reapareceria só no próximo ping de localização — até ~10s parecendo
// indisponível para quem está pedindo carro ao lado dele.
const announceCaptainAvailable = (captain, ride) => {
    if (!captain || captain.isOnline === false || captain.canReceiveRides === false) return;

    // `lastLocation` é gravada durante a corrida e é mais fresca que `captain.location`,
    // que vem do perfil em cache.
    const ltd = ride?.lastLocation?.lat ?? captain.location?.ltd;
    const lng = ride?.lastLocation?.lng ?? captain.location?.lng;
    if (ltd == null || lng == null) return;

    emitDriverMapUpdate(captain._id, {
        busy: false,
        vehicleType: captain.vehicle?.vehicleType || 'car',
        location: { ltd, lng }
    });
}

module.exports.endRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.endRide({ rideId, captain: req.captain });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-ended',
            data: ride
        })
        notificationService.sendRideFinished(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);

        announceCaptainAvailable(req.captain, ride);

        // Invalidate dashboard and history cache
        deleteCache('dashboard:today');
        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id}`);
        }

        return res.status(200).json(ride);
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride not started') {
            return res.status(409).json({ message: 'Corrida não está mais num estado que permita finalizar.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.payRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.payRide({ rideId, user: req.user });

        // Notify captain that payment was completed
        if (ride.captain?.socketId) {
            sendMessageToSocketId(ride.captain.socketId, {
                event: 'payment-completed',
                data: ride
            });
        }
        // Fase 5 da auditoria de push (2026-08-02): antes só socket — motorista sem o
        // app aberto no instante do pagamento nunca era avisado.
        if (ride.captain?._id) {
            notificationService.sendPaymentCompleted(ride.captain._id, { rideId: ride._id.toString() }).catch(console.error);
        }

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmPaymentReceived = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.confirmPaymentReceived({ rideId, captain: req.captain });

        // Notify passenger that payment was confirmed
        if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'payment-confirmed',
                data: ride
            });
        }
        if (ride.user?._id) {
            // Push Notification para o passageiro "Pagamento confirmado"
            notificationService.sendToUser(ride.user._id, 'Pagamento Confirmado', 'Recebemos o seu pagamento, muito obrigado!', 'ADMIN', { rideId: ride._id.toString() }).catch(console.error);
        }

        // Invalidate dashboard and history cache
        deleteCache('dashboard:today');
        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id}`);
        }

        return res.status(200).json(ride);
    } catch (err) {
        // Pagamento já confirmado é o desfecho esperado de uma corrida (duplo clique,
        // retry de rede) — 409, não 500, igual ao acceptRide para RIDE_ALREADY_ACCEPTED.
        if (err.message === 'Payment already confirmed') {
            return res.status(409).json({ message: 'Este pagamento já foi confirmado.' });
        }
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride not finished yet') {
            return res.status(409).json({ message: 'Corrida ainda não foi finalizada.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.getRideHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || 'all';
        const search = req.query.search || '';

        const cacheKey = `history:${req.user._id}:${page}:${limit}:${status}:${search}`;
        const cached = getCache(cacheKey);

        if (cached) {
            return res.status(200).json(cached);
        }

        const skip = (page - 1) * limit;

        const query = { user: req.user._id };
        if (status !== 'all') {
            if (status === 'completed') {
                query.status = 'finished';
            } else if (status === 'cancelled') {
                query.status = 'cancelled';
            } else if (status === 'ongoing') {
                // 'pending'/'ongoing' nunca existiram no enum de ride.status — o filtro só
                // pegava 'accepted' de fato, perdendo corridas indo/chegando/em viagem.
                query.status = { $in: ['requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started'] };
            }
        }

        if (search) {
            query.$or = [
                { pickup: { $regex: search, $options: 'i' } },
                { destination: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await rideModel.countDocuments(query);
        const rides = await rideModel.find(query)
            .populate('captain')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const responseData = {
            rides,
            page,
            limit,
            total,
            hasNext: (skip + limit) < total
        };

        // Cache for 5 minutes
        setCache(cacheKey, responseData, 300);

        return res.status(200).json(responseData);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.getCurrentRide = async (req, res) => {
    try {
        const ride = await rideService.getCurrentRide({ user: req.user._id });
        if (!ride) {
            return res.status(404).json({ message: 'No active ride found' });
        }
        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// Auditoria de UX do motorista (2026-08-02): equivalente a getCurrentRide, mas para o
// motorista — usado por CaptainRiding.jsx para se recuperar de um refresh de página
// sem depender só do location.state do react-router (que se perde em qualquer reload).
module.exports.getCurrentRideForCaptain = async (req, res) => {
    try {
        const ride = await rideService.getCurrentRideForCaptain({ captain: req.captain._id });
        if (!ride) {
            return res.status(404).json({ message: 'No active ride found' });
        }
        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// Fase B da experiência de corrida ativa (2026-08-03): pull de corridas pendentes
// compatíveis — o caminho de recuperação para quando o evento 'new-ride' se perdeu
// (app fechado, push falhou, reconexão). O frontend chama no mount, no reconnect do
// socket, no retorno do background e no evento 'online'.
module.exports.getPendingRides = async (req, res) => {
    try {
        const rides = await rideService.getPendingRidesForCaptain({ captain: req.captain });
        return res.status(200).json(rides);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// Auditoria de UX do motorista (2026-08-02): motorista desiste de uma corrida já
// aceita (mas não iniciada) — a corrida volta ao pool de despacho em vez de terminar,
// pra não obrigar o passageiro a pedir tudo de novo (decisão do usuário do produto).
module.exports.captainCancelRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, reason } = req.body;

    try {
        const ride = await rideService.cancelRideByCaptain({ rideId, captain: req.captain._id, reason });

        const TRACE_ID = `Ride:${ride._id}`;

        // Implementação do sistema de cancelamento (2026-08-04): CORRIGIDO — antes usava
        // sendMessageToRoom(`ride_${id}`), mas essa sala só tem os motoristas CANDIDATOS
        // do despacho original (addSocketToRoom só é chamado pra motorista, nunca pro
        // passageiro — ver dispatchRideToCaptains). O evento nunca alcançava o
        // passageiro de verdade. sendMessageToSocketId manda direto pro socket dele,
        // igual a todo outro evento direcionado ao passageiro (ride-confirmed,
        // ride-started, ride-status-updated).
        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-cancelled-by-captain',
            data: { rideId: ride._id }
        });

        // Push como reforço — o socket acima só funciona com o app aberto/conectado
        // naquele instante (mesmo motivo do A6 da auditoria de push, agora na direção
        // oposta: motorista cancela, passageiro precisa saber mesmo em segundo plano).
        notificationService.sendRideRequeuedToUser(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);

        await dispatchRideToCaptains(ride, {
            pickup: ride.pickup,
            vehicleType: ride.vehicleType,
            TRACE_ID,
            excludeCaptainId: req.captain._id
        });

        announceCaptainAvailable(req.captain, ride);

        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride cannot be cancelled at this stage') {
            return res.status(409).json({ message: 'Não é mais possível cancelar esta corrida.' });
        }
        if (err.message === 'Cancellation reason is required at this stage') {
            return res.status(400).json({ message: 'Informe o motivo do cancelamento.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.cancelRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, reason } = req.body;

    try {
        const ride = await rideService.cancelRide({ rideId, user: req.user._id, reason });

        // Notify all captains in the room that the ride was cancelled
        sendMessageToRoom(`ride_${ride._id}`, {
            event: 'ride-cancelled',
            data: { rideId: ride._id }
        });

        // A6 da auditoria de push (2026-08-02): sendMessageToRoom sozinho não é
        // confiável — a sala é populada por socketId no momento do despacho, e
        // socketId muda a cada reconexão; um motorista que perdeu a conexão por um
        // instante nunca recebia o aviso. Só se aplica quando já havia um motorista
        // especificamente designado (senão o "cancelamento" é só a corrida sumir do
        // pool de despacho, sem ninguém comprometido pra avisar).
        if (ride.captain) {
            notificationService.sendRideCancelledToCaptain(ride.captain, { rideId: ride._id.toString() }).catch(console.error);
        }

        // Invalidate dashboard and history cache
        deleteCache('dashboard:today');
        deleteByPrefix(`history:${req.user._id}`);

        return res.status(200).json(ride);
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride cannot be cancelled at this stage') {
            return res.status(409).json({ message: 'Não é mais possível cancelar esta corrida.' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.submitReview = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, rating, comment, issueCategory } = req.body;

    try {
        const review = await rideService.submitReview({
            rideId, user: req.user._id, rating, comment, issueCategory
        });

        // Fase 7 da correção do sistema de push (2026-08-02): passageiro marcando uma
        // categoria de problema na avaliação é uma denúncia — antes, isso só aparecia
        // pra quem fosse conferir avaliações no painel por conta própria. 'none' é um
        // valor válido do enum (route.ride.js) que significa "sem problema" — não é
        // denúncia, então não pode disparar o alerta.
        if (issueCategory && issueCategory !== 'none') {
            notificationService.sendComplaintAlert(rideId, issueCategory).catch(console.error);
        }

        return res.status(201).json(review);
    } catch (err) {
        if (err.message === 'Ride already reviewed') {
            return res.status(409).json({ message: 'Você já avaliou esta corrida.' });
        }
        return res.status(400).json({ message: err.message });
    }
}

// Auditoria de UX do motorista (2026-08-02, Etapa 7): motorista avalia o passageiro —
// espelha submitReview acima.
module.exports.submitCaptainReview = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, rating, comment } = req.body;

    try {
        const review = await rideService.submitCaptainReview({
            rideId, captain: req.captain._id, rating, comment
        });
        return res.status(201).json(review);
    } catch (err) {
        if (err.message === 'Ride already reviewed') {
            return res.status(409).json({ message: 'Você já avaliou esta corrida.' });
        }
        return res.status(400).json({ message: err.message });
    }
}
module.exports.dispatchRideToCaptains = dispatchRideToCaptains;
