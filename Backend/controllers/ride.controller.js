const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const { sendMessageToSocketId, addSocketToRoom, sendMessageToRoom, emitDriverMapUpdate } = require('../socket');
const rideModel = require('../models/ride.model');
const { getCache, setCache, deleteByPrefix } = require('../cache/cache');
const notificationService = require('../services/notification.service');
const { calculateLiveRideFare } = require('../services/liveRideFare.service');
const captainModel = require('../models/captain.model');
const { computeDriverAmount } = require('../utils/financePrivacy');
const { computeOfferExpiresAt } = require('../config/offerPolicy');
const {
    toRideOfferDTO,
    toRideCaptainDTO,
    toRidePassengerDTO,
    toRideCaptainHistoryDTO,
    toRidePassengerHistoryDTO,
} = require('../utils/actorDtos');
const {
    RIDE_SHARE_TTL_SECONDS,
    ACTIVE_SHARED_RIDE_STATUSES,
    createRideShareAccess,
    verifyRideShareToken,
    validateRideShareAccess,
    toSharedRideResponse,
} = require('../utils/rideShareAccess');
const {
    PAYMENT_REPORTED_EVENT,
    buildCaptainPaymentReportPayload,
    buildPassengerPaymentReportResponse,
} = require('../utils/paymentReportContract');

/** Resposta de corrida para motorista: sem comissão/bruto; OTP só em presencial. */
function toCaptainRideResponse(ride, { keepPresentialOtp = false } = {}) {
    if (!ride) return ride;
    const raw = typeof ride.toObject === 'function' ? ride.toObject() : ride;
    if (raw.status === 'requested') return toRideOfferDTO(raw);
    return toRideCaptainDTO(raw, { includePresentialOtp: keepPresentialOtp });
}

function sanitizeCaptainRideHistoryPayload(data) {
    if (!data) return data;
    return {
        ...data,
        activeRide: data.activeRide ? toCaptainRideResponse(data.activeRide, { keepPresentialOtp: true }) : null,
        pendingOffers: (data.pendingOffers || []).map((ride) => toCaptainRideResponse(ride)),
        rides: (data.rides || []).map((ride) => toRideCaptainHistoryDTO(ride)),
    };
}

// Busca motoristas compatíveis no raio de despacho e emite 'new-ride' para cada um.
// Extraído de createRide (auditoria de UX do motorista, 2026-08-02) para ser reaproveitado
// por captainCancelRide — quando um motorista desiste de uma corrida já aceita, ela
// precisa ser redespachada exatamente da mesma forma que uma corrida recém-criada,
// exceto que o motorista que acabou de desistir não deve ser candidato de novo.
// Exportada além de usada internamente (Bloco E da auditoria administrativa, 2026-08-02):
// a reatribuição de corrida pelo painel admin precisa do mesmo redespacho — sem isso,
// a corrida voltava a 'requested' mas nenhum motorista era notificado, ficando travada.
async function dispatchRideToCaptains(ride, { pickup, vehicleType, TRACE_ID, excludeCaptainId, targetCaptainId, pickupCoordinates } = {}) {
    const dispatchService = require('../services/dispatch.service');
    // Motorista com qualquer trabalho ativo não pode aceitar outra oferta.
    const { pickupCoordinates: resolvedPickupCoordinates, captains } = await dispatchService.findCaptainsNearPickup(
        pickup,
        vehicleType,
        { TRACE_ID, excludeCaptainId, excludeActiveRide: true, excludeActiveParcel: true, serviceKind: ride.scheduledAt ? 'scheduledRide' : 'ride', pickupCoordinates }
    );
    const matchingCaptains = targetCaptainId
        ? captains.filter((captain) => captain._id.toString() === targetCaptainId.toString())
        : captains;

    console.log(`[AUDIT][${TRACE_ID}] Pickup Coords:`, resolvedPickupCoordinates);
    console.log(`[AUDIT][${TRACE_ID}] Matching Captains finais:`, matchingCaptains.length);

    // Persiste as coordenadas do embarque na própria corrida (Etapa 6 da auditoria de UX,
    // 2026-08-02) — o frontend usa isso pra mostrar a distância até o passageiro no popup
    // de oferta, calculada localmente a partir da posição GPS do motorista.
    const rideWithUser = await rideModel.findOneAndUpdate(
        { _id: ride._id },
        { pickupCoordinates: { lat: resolvedPickupCoordinates.lat, lng: resolvedPickupCoordinates.lng } },
        { new: true }
    ).populate('user', 'fullname');

    matchingCaptains.forEach(captain => {
        // Put captain in a room for this specific ride
        addSocketToRoom(captain.socketId, `ride_${ride._id}`);

        console.log(`[AUDIT][${TRACE_ID}] Emitindo 'new-ride' para socketId ${captain.socketId} (Captain: ${captain._id})`);
        sendMessageToSocketId(captain.socketId, {
            event: 'new-ride',
            data: toCaptainRideResponse(rideWithUser)
        });
        // C5 da auditoria de push (2026-08-02): disparado sem await de propósito (não
        // atrasar o despacho da corrida), mas sem .catch() uma falha aqui virava unhandled
        // rejection capaz de derrubar o processo — o service já tem try/catch interno
        // desde a mesma auditoria, isto é defesa em profundidade.
        // Payload rico pro body da push (2026-08-04): valor do passageiro, rota, distância,
        // tempo, passageiro e categoria — sem botões Aceitar/Recusar na notificação.
        // Sem comissão/% no payload (sanitização financeira).
        notificationService.sendNewRide(captain._id, {
            rideId: rideWithUser._id.toString(),
            fare: rideWithUser.finalPrice ?? rideWithUser.fare,
            pickup: rideWithUser.pickup,
            destination: rideWithUser.destination,
            estimatedDistance: rideWithUser.estimatedDistance,
            estimatedTime: rideWithUser.estimatedTime,
            vehicleType: rideWithUser.vehicleType || vehicleType,
            // Auditoria PWA (2026-08-07, P1): mesma âncora do socket/pull — o
            // popup do PWA sincroniza o contador com isto em vez de um timer
            // local. Campo extra e inofensivo pro Android nativo (ele não lê
            // esta chave hoje).
            offerExpiresAt: computeOfferExpiresAt(rideWithUser)?.toISOString(),
            passengerName: rideWithUser.user?.fullname?.firstname || rideWithUser.adminPassenger?.name || '',
            isScheduled: Boolean(rideWithUser.scheduledAt),
            scheduledAt: rideWithUser.scheduledAt,
        }, TRACE_ID).catch(console.error);
    });

    return matchingCaptains.length;
}

module.exports.createRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log(`[AUDIT] /rides/create Validation Errors:`, errors.array());
        return res.status(400).json({ errors: errors.array() });
    }

    const { userId, pickup, destination, vehicleType, paymentMethod, optionals, observation, useWalletBalance, requestFemaleDriver, promoCode, scheduledAt } = req.body;

    try {
        if (!req.user || !req.user._id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        // Bloco H (2026-08-02): createRide agora devolve { ride, promoError } — um cupom
        // inválido não impede a corrida de ser criada, só não aplica desconto; o motivo
        // vai junto na resposta pro app do passageiro decidir como avisar.
        const idempotencyKey = req.get('Idempotency-Key');
        const { ride, promoError, replayed } = await rideService.createRide({
            user: req.user._id,
            pickup,
            destination,
            vehicleType,
            paymentMethod,
            optionals,
            observation,
            useWalletBalance,
            requestFemaleDriver,
            promoCode,
            scheduledAt,
            idempotencyKey,
        });

        const TRACE_ID = `Ride:${ride._id}`;
        console.log(`[AUDIT][${TRACE_ID}] Corrida criada no DB para usuário ${req.user._id}`);

        // Replay confirma o recurso já criado, sem repetir push/despacho. Corridas
        // requested continuam visíveis no pull dos motoristas se a conexão anterior
        // tiver caído entre o commit e a emissão por socket.
        if (!replayed) {
            // Agendada: sem despacho agora — o cron ativa perto do horário.
            if (ride.status === 'scheduled') {
                notificationService.sendScheduleCreated(req.user._id, {
                    kind: 'ride',
                    id: ride._id.toString(),
                    rideId: ride._id.toString(),
                    scheduledAt: ride.scheduledAt,
                });
            } else {
                await dispatchRideToCaptains(ride, { pickup, vehicleType, TRACE_ID });
            }
        }

        // Invalida cache de histórico do usuário
        deleteByPrefix(`history:${req.user._id}`);

        res.set('Idempotency-Replayed', String(Boolean(replayed)));
        res.status(replayed ? 200 : 201).json({ ...toRidePassengerDTO(ride), promoError });

    } catch (err) {
        console.error(`[AUDIT] Erro crítico no createRide:`, err);
        // Mesmos códigos do fluxo presencial: o passageiro precisa saber que o
        // endereço não fecha, em vez de ver um preço inventado ou um erro genérico.
        if (err.code === 'IMPLAUSIBLE_ROUTE_DISTANCE') {
            return res.status(400).json({
                code: err.code,
                message: 'Não foi possível calcular esta rota. Confira o endereço de partida e o de destino.',
            });
        }
        if (err.code === 'ZERO_DISTANCE_ROUTE') {
            return res.status(400).json({
                code: err.code,
                message: 'A partida e o destino são praticamente o mesmo lugar. Confira os endereços.',
            });
        }
        if (err.code === 'ROUTE_CALCULATION_FAILED') {
            return res.status(502).json({ message: 'Não foi possível calcular a rota agora. Tente novamente.' });
        }
        if (err.code === 'USER_HAS_ACTIVE_PARCEL' || err.message === 'USER_HAS_ACTIVE_PARCEL') {
            return res.status(409).json({ message: 'Você já possui uma encomenda em andamento.' });
        }
        if (err.code === 'USER_HAS_ACTIVE_RIDE' || err.message === 'USER_HAS_ACTIVE_RIDE') {
            return res.status(409).json({
                message: 'Você já possui uma corrida em andamento.',
                activeRideId: err.activeRideId,
            });
        }
        if (err.code === 'SCHEDULE_TOO_SOON') {
            return res.status(400).json({ message: 'Agende com pelo menos 15 minutos de antecedência.' });
        }
        if (err.code === 'SCHEDULE_TOO_FAR') {
            return res.status(400).json({ message: 'Agendamento máximo de 7 dias.' });
        }
        if (err.code === 'INVALID_SCHEDULED_AT') {
            return res.status(400).json({ message: 'Data/hora de agendamento inválida.' });
        }
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
        // Mesmos códigos do fluxo presencial: o passageiro precisa saber que o
        // endereço não fecha, em vez de ver um preço inventado ou um erro genérico.
        if (err.code === 'IMPLAUSIBLE_ROUTE_DISTANCE') {
            return res.status(400).json({
                code: err.code,
                message: 'Não foi possível calcular esta rota. Confira o endereço de partida e o de destino.',
            });
        }
        if (err.code === 'ZERO_DISTANCE_ROUTE') {
            return res.status(400).json({
                code: err.code,
                message: 'A partida e o destino são praticamente o mesmo lugar. Confira os endereços.',
            });
        }
        if (err.code === 'ROUTE_CALCULATION_FAILED') {
            return res.status(502).json({ message: 'Não foi possível calcular a rota agora. Tente novamente.' });
        }
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

    // Simplificação do cadastro do motorista (2026-08-04): reforço direto no aceite —
    // o despacho já filtra por approvalStatus:'aprovado' (availabilityFilter em
    // captain.service.js) e toggleOnline já bloqueia ficar online sem aprovação, mas
    // nenhum dos dois impede uma chamada direta a este endpoint com um rideId obtido
    // por outro meio. Checagem redundante de propósito — a regra não pode depender só
    // de o motorista nunca ter sido convidado a aceitar.
    if (captain.approvalStatus !== 'aprovado' || captain.isBlocked || captain.canReceiveRides === false) {
        return res.status(403).json({ message: 'Documentação pendente. Envie e aguarde a aprovação dos seus documentos para começar a receber corridas.' });
    }

    try {
        console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} tentando aceitar a corrida.`);
        const ride = await rideService.acceptRideAtomic({ rideId, captain });
        console.log(`[AUDIT][${TRACE_ID}] Corrida aceita com sucesso pelo Captain ${captain._id}.`);

        if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'ride-confirmed',
                data: toRidePassengerDTO(ride),
            });
        }
        if (ride.user?._id) {
            notificationService.sendRideAccepted(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);
        }

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

        // Privacidade financeira + OTP: motorista não recebe comissão/bruto nem PIN
        // (exceto presencial, tratado em getCurrentRideForCaptain).
        const rideForCaptain = toCaptainRideResponse(ride);


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
        if (err.message === 'VEHICLE_MISMATCH') {
            return res.status(403).json({ message: 'Você não está autorizado a atender este tipo de corrida.' });
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

module.exports.declineRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    await rideService.declineRide({
        rideId: req.params.id,
        captain: req.captain,
    });
    return res.status(200).json({ ok: true });
}

module.exports.createPresentialRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        destination,
        destinationPending,
        paymentMethod,
        passengerPhone,
        lat,
        lng,
        vehicleType,
    } = req.body;

    try {
        const ride = await rideService.createPresentialRide({
            captain: req.captain,
            destination: destinationPending ? null : destination,
            destinationPending: !!destinationPending,
            paymentMethod: paymentMethod || 'cash',
            passengerPhone: passengerPhone || null,
            clientLat: lat != null ? Number(lat) : null,
            clientLng: lng != null ? Number(lng) : null,
            vehicleType: vehicleType || null,
        });

        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id || ride.user}`);
        }

        // NUNCA despacha — source=driver_initiated já vinculada ao motorista.
        return res.status(201).json(toCaptainRideResponse(ride, { keepPresentialOtp: true }));
    } catch (err) {
        if (err.code === 'CAPTAIN_NOT_ALLOWED') {
            return res.status(403).json({ message: 'Motorista não autorizado a iniciar corrida presencial.' });
        }
        if (err.code === 'INVALID_CAPTAIN_LOCATION') {
            return res.status(400).json({ message: 'Localização GPS do motorista inválida ou indisponível.' });
        }
        if (err.code === 'CAPTAIN_BUSY') {
            return res.status(409).json({ message: 'Você já possui uma corrida ou encomenda em andamento.' });
        }
        if (err.code === 'PRESENTIAL_CASH_ONLY') {
            return res.status(400).json({ message: 'Corrida presencial aceita apenas pagamento em dinheiro.' });
        }
        if (err.code === 'VEHICLE_NOT_AUTHORIZED') {
            return res.status(403).json({ message: 'Você não está autorizado a rodar nesta categoria de veículo.' });
        }
        if (err.code === 'USER_HAS_ACTIVE_PARCEL' || err.code === 'USER_HAS_ACTIVE_RIDE') {
            return res.status(409).json({ message: 'O passageiro informado já possui um serviço em andamento.' });
        }
        if (err.message === 'Destination is required when not pending') {
            return res.status(400).json({ message: 'Informe o destino ou escolha definir ao finalizar.' });
        }
        if (err.code === 'IMPLAUSIBLE_ROUTE_DISTANCE') {
            return res.status(400).json({
                code: err.code,
                message: 'O ponto de partida detectado está muito longe do destino. Verifique se o GPS está ativo e com sinal.',
            });
        }
        if (err.code === 'ZERO_DISTANCE_ROUTE') {
            return res.status(400).json({
                code: err.code,
                message: 'O ponto de partida detectado está praticamente no destino. Confira o GPS e o endereço informado.',
            });
        }
        if (err.code === 'ROUTE_CALCULATION_FAILED') {
            return res.status(502).json({ message: 'Não foi possível calcular a rota até o destino. Tente novamente.' });
        }
        console.error('[AUDIT] createPresentialRide error:', err);
        return res.status(500).json({ message: err.message });
    }
};

module.exports.estimatePresentialFare = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { destination, lat, lng, vehicleType } = req.query;

    try {
        const estimate = await rideService.estimatePresentialFare({
            captain: req.captain,
            destination,
            clientLat: lat != null ? Number(lat) : null,
            clientLng: lng != null ? Number(lng) : null,
            vehicleType: vehicleType || null,
        });
        // Motorista vê o valor a cobrar do passageiro; sem fareBreakdown/comissão.
        const driverAmount = computeDriverAmount({
            fare: estimate.fare,
            commissionAmount: estimate.fareBreakdown?.platformCommission,
        });
        return res.status(200).json({
            pickupCoordinates: estimate.pickupCoordinates,
            estimatedDistance: estimate.estimatedDistance,
            estimatedTime: estimate.estimatedTime,
            fare: estimate.fare,
            driverAmount,
        });
    } catch (err) {
        if (err.code === 'INVALID_CAPTAIN_LOCATION') {
            return res.status(400).json({ message: 'Localização GPS do motorista inválida ou indisponível.' });
        }
        if (err.code === 'VEHICLE_NOT_AUTHORIZED') {
            return res.status(403).json({ message: 'Você não está autorizado a rodar nesta categoria de veículo.' });
        }
        if (err.code === 'IMPLAUSIBLE_ROUTE_DISTANCE') {
            return res.status(400).json({
                code: err.code,
                message: 'O ponto de partida detectado está muito longe do destino. Verifique se o GPS está ativo e com sinal.',
            });
        }
        if (err.code === 'ZERO_DISTANCE_ROUTE') {
            return res.status(400).json({
                code: err.code,
                message: 'O ponto de partida detectado está praticamente no destino. Confira o GPS e o endereço informado.',
            });
        }
        if (err.code === 'ROUTE_CALCULATION_FAILED') {
            return res.status(502).json({ message: 'Não foi possível calcular a rota até o destino. Tente novamente.' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.listPresentialVehicleOptions = async (req, res) => {
    try {
        const options = await rideService.listPresentialVehicleOptions({ captain: req.captain });
        return res.status(200).json(options);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.startRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, otp, occurredAt } = req.query;

    try {
        const ride = await rideService.startRide({
            rideId,
            otp,
            captain: req.captain,
            occurredAt: occurredAt == null ? null : Number(occurredAt),
        });

        // Não logar o documento da ride — OTP e PII (auditoria presencial).
        console.log(`[AUDIT] startRide ok ride=${ride._id} captain=${req.captain._id} source=${ride.source || 'passenger_requested'}`);

        if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'ride-started',
                data: toRidePassengerDTO(ride)
            });
        }
        if (ride.user?._id) {
            notificationService.sendRideStarted(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);
        }


        return res.status(200).json(toCaptainRideResponse(ride, { keepPresentialOtp: true }));
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

        if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'ride-status-updated',
                data: toRidePassengerDTO(ride),
            });
        }

        // A5 da auditoria de push (2026-08-02): "motorista chegou" é justamente o
        // momento em que o passageiro mais provavelmente NÃO está com o app aberto —
        // socket sozinho não alcança quem não está olhando a tela.
        if (status === 'arrived' && ride.user?._id) {
            notificationService.sendCaptainArrived(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);
        }


        return res.status(200).json(toCaptainRideResponse(ride, { keepPresentialOtp: true }));
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
        vehicleAuthorization: require('../services/vehicleAuthorization.service')
            .deriveLegacyAuthorization(captain),
        location: { ltd, lng }
    });
}

module.exports.endRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, destination, finishLat, finishLng, finishAccuracy, finishTimestamp } = req.body;

    try {
        const hasFinishCoordinates = finishLat != null && finishLng != null;
        const ride = await rideService.endRide({
            rideId,
            captain: req.captain,
            destination: destination || null,
            finishLocation: hasFinishCoordinates ? {
                lat: Number(finishLat),
                lng: Number(finishLng),
                accuracy: finishAccuracy == null ? null : Number(finishAccuracy),
                timestamp: finishTimestamp == null ? null : Number(finishTimestamp),
            } : null,
        });

        if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'ride-ended',
                data: toRidePassengerDTO(ride)
            });
        }
        if (ride.user?._id) {
            notificationService.sendRideFinished(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);
            // Comissão/repasse agora liquidam pra qualquer método assim que a corrida
            // finaliza (2026-08-16), não só carteira — mas esta notificação específica
            // ("pagamento pela carteira foi conciliado") continua só fazendo sentido
            // pra carteira; dinheiro/cartão o passageiro já sabe que pagou na hora.
            if (ride.paymentStatus === 'paid' && ride.paymentMethod === 'carteira') {
                notificationService.sendToUser(
                    ride.user._id,
                    'Pagamento confirmado',
                    'O pagamento pela carteira foi conciliado com sucesso.',
                    'ADMIN',
                    { rideId: ride._id.toString() }
                ).catch(console.error);
            } else if (ride.walletSettlementStatus === 'shortfall') {
                notificationService.sendToUser(
                    ride.user._id,
                    'Saldo insuficiente na carteira',
                    'O valor final da corrida excedeu o saldo reservado. Regularize o pagamento no app para concluir a corrida.',
                    'ADMIN',
                    { rideId: ride._id.toString(), amountDue: String(ride.walletShortfallAmount || 0) }
                ).catch(console.error);
            }
        }

        announceCaptainAvailable(req.captain, ride);

        // Invalida cache de histórico do usuário
        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id}`);
        }

        return res.status(200).json(toCaptainRideResponse(ride));
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride not started') {
            return res.status(409).json({ message: 'Corrida não está mais num estado que permita finalizar.' });
        }
        if (err.code === 'FINALIZATION_IN_PROGRESS') {
            return res.status(409).json({ message: 'A finalização desta corrida já está em processamento. Tente novamente em instantes.' });
        }
        if (err.code === 'INVALID_FINISH_LOCATION' || err.message === 'INVALID_FINISH_LOCATION') {
            return res.status(400).json({
                message: 'GPS inválido ao finalizar. Aguarde sinal de localização e tente novamente.',
            });
        }
        if (err.code === 'STALE_FINISH_LOCATION') {
            return res.status(400).json({
                message: 'Localização desatualizada. Mantenha o GPS ativo por alguns segundos e tente novamente.',
            });
        }
        if (err.code === 'INSUFFICIENT_TRIP_DISTANCE') {
            return res.status(400).json({
                message: 'Distância insuficiente para finalizar. Continue a corrida com GPS ativo ou cancele se foi um engano.',
            });
        }
        if (err.code === 'ROUTE_CALCULATION_FAILED' || err.code === 'PRICING_FAILED') {
            return res.status(502).json({
                message: 'Não foi possível calcular rota/tarifa agora. Tente novamente em instantes.',
            });
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
        const { ride, reportStatus, shouldNotify } = await rideService.payRide({ rideId, user: req.user });

        // "Passageiro informou" não é "pagamento recebido". Somente a primeira
        // chamada emite aviso; retries recebem 200 sem duplicar socket/push.
        if (shouldNotify && ride.captain?.socketId) {
            sendMessageToSocketId(ride.captain.socketId, {
                event: PAYMENT_REPORTED_EVENT,
                data: buildCaptainPaymentReportPayload(ride)
            });
        }
        if (shouldNotify && ride.captain?._id) {
            notificationService.sendPaymentReported(ride.captain._id, {
                rideId: ride._id.toString(),
            }).catch(console.error);
        }

        return res.status(200).json(buildPassengerPaymentReportResponse(ride, reportStatus));
    } catch (err) {
        if (err.code === 'RIDE_NOT_FOUND') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.code === 'RIDE_NOT_FINISHED') {
            return res.status(409).json({ message: 'A corrida ainda não foi finalizada.' });
        }
        if (err.code === 'PAYMENT_REPORT_NOT_ALLOWED') {
            return res.status(409).json({ message: 'Este meio de pagamento não aceita confirmação manual do passageiro.' });
        }
        if (err.code === 'PAYMENT_NOT_PENDING') {
            return res.status(409).json({ message: 'Este pagamento não está pendente.' });
        }
        if (err.code === 'PAYMENT_REPORT_CONFLICT') {
            return res.status(409).json({ message: 'Não foi possível registrar agora. Tente novamente.' });
        }
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
                data: toRidePassengerDTO(ride)
            });
        }
        if (ride.user?._id) {
            // Push Notification para o passageiro "Pagamento confirmado"
            notificationService.sendToUser(ride.user._id, 'Pagamento Confirmado', 'Recebemos o seu pagamento, muito obrigado!', 'ADMIN', { rideId: ride._id.toString() }).catch(console.error);
        }

        // Invalida cache de histórico do usuário
        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id}`);
        }

        return res.status(200).json(toCaptainRideResponse(ride));
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
        if (err.code === 'WALLET_PAYMENT_IS_AUTOMATIC') {
            return res.status(409).json({ message: 'Pagamento por carteira é confirmado automaticamente pela plataforma.' });
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
            .populate('captain', 'fullname profilePicture rating vehicle vehicleAuthorization')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const responseData = {
            rides: rides.map((ride) => toRidePassengerHistoryDTO(ride)),
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

        // A localização via socket continua sendo o caminho de menor latência, mas não
        // pode ser a única fonte da tarifa ao vivo: o GPS pode ficar suspenso em segundo
        // plano e o preço também depende do tempo transcorrido. Toda reconciliação de
        // /rides/current devolve um snapshot novo, permitindo que o passageiro recupere
        // o valor correto após refresh, reconexão ou alguns segundos sem heartbeat.
        let liveFare = null;
        try {
            liveFare = await calculateLiveRideFare({
                ride,
                actualDistance: ride.actualDistance,
            });
        } catch (fareError) {
            // Uma falha pontual de precificação não pode esconder a corrida ativa.
            // O cliente mantém a última estimativa conhecida e tenta novamente.
            console.error('Erro reconciliando valor ao vivo da corrida:', fareError);
        }

        const payload = toRidePassengerDTO(ride);
        return res.status(200).json(liveFare ? { ...payload, liveFare } : payload);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.createRideShareLink = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0]?.msg || 'Corrida inválida' });
        }

        const access = createRideShareAccess({
            rideId: req.body.rideId,
            userId: req.user._id,
        });
        // A gravação e a validação de dono/estado são uma única operação.
        // Criar outro link substitui o hash atual e revoga imediatamente o anterior.
        const ride = await rideModel.findOneAndUpdate({
            _id: req.body.rideId,
            user: req.user._id,
            status: { $in: ACTIVE_SHARED_RIDE_STATUSES },
        }, {
            $set: { shareAccess: access.record },
        }, { new: true }).select('_id user');
        if (!ride) {
            return res.status(404).json({ message: 'Corrida ativa não encontrada.' });
        }

        const frontendOrigin = String(process.env.FRONTEND_URL || req.get('origin') || '').replace(/\/$/, '');
        const path = `/track/${encodeURIComponent(access.token)}`;

        return res.status(201).json({
            token: access.token,
            expiresInSeconds: RIDE_SHARE_TTL_SECONDS,
            url: frontendOrigin ? `${frontendOrigin}${path}` : path,
        });
    } catch (err) {
        return res.status(500).json({ message: 'Não foi possível criar o compartilhamento.' });
    }
}

module.exports.getSharedRide = async (req, res) => {
    try {
        const payload = verifyRideShareToken(req.params.token);
        const ride = await rideModel.findById(payload.rideId)
            .select('user status pickup destination captain lastLocation updatedAt +shareAccess +shareLocation');
        if (!ride || String(ride.user) !== String(payload.userId)) {
            return res.status(404).json({ message: 'Corrida compartilhada não encontrada.' });
        }
        const access = validateRideShareAccess(payload, ride.shareAccess);
        if (!access.valid) {
            return res.status(410).json({ message: 'Este compartilhamento foi encerrado.' });
        }

        // Não seleciona `location`: o endpoint público nunca consulta o GPS atual do
        // motorista. A posição ativa vem do registro vinculado à corrida e some
        // completamente no estado final.
        const captain = ride.captain
            ? await captainModel.findById(ride.captain)
                .select('fullname profilePicture rating vehicle')
            : null;
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json(toSharedRideResponse({ ride, captain }));
    } catch (err) {
        if (err?.name === 'TokenExpiredError') {
            return res.status(410).json({ message: 'Este compartilhamento expirou.' });
        }
        return res.status(401).json({ message: 'Compartilhamento inválido.' });
    }
}

module.exports.revokeRideShareLink = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0]?.msg || 'Corrida inválida' });
        }

        const revoked = await rideModel.findOneAndUpdate({
            _id: req.params.rideId,
            user: req.user._id,
            'shareAccess.tokenHash': { $exists: true },
        }, {
            $set: { 'shareAccess.revokedAt': new Date() },
        }, { new: true }).select('_id');

        if (!revoked) {
            const ownedRide = await rideModel.exists({
                _id: req.params.rideId,
                user: req.user._id,
            });
            if (!ownedRide) {
                return res.status(404).json({ message: 'Corrida não encontrada.' });
            }
        }

        // Idempotente: encerrar novamente não revela se um link estava ativo.
        return res.status(204).send();
    } catch (err) {
        return res.status(500).json({ message: 'Não foi possível encerrar o compartilhamento.' });
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

        // Mesma reconciliação já usada em getCurrentRide (passageiro): o valor "ao vivo"
        // empurrado por socket só se atualiza quando chega um ponto de GPS novo, e pode
        // ficar minutos parado com sinal ruim ou corrida praticamente parada. Buscar
        // /rides/captain-current pede um valor fresco (mesma distância já registrada,
        // tempo recalculado agora) — usado pelo app pra mostrar o valor real antes de
        // finalizar, não só depois.
        let liveFare = null;
        try {
            liveFare = await calculateLiveRideFare({
                ride,
                actualDistance: ride.actualDistance,
            });
        } catch (fareError) {
            console.error('Erro reconciliando valor ao vivo da corrida (motorista):', fareError);
        }

        const payload = toCaptainRideResponse(ride, { keepPresentialOtp: true });
        return res.status(200).json(liveFare ? { ...payload, liveFare } : payload);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// Aba "Corridas" do motorista — identidade vem só do token (authCaptain), nunca de
// captainId arbitrário no query/body.
module.exports.getCaptainRideHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const data = await rideService.getCaptainRideHistory({
            captain: req.captain,
            page,
            limit,
        });
        return res.status(200).json(sanitizeCaptainRideHistoryPayload(data));
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
        return res.status(200).json(rides.map((ride) => toCaptainRideResponse(ride)));
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
        // Presencial: cancelamento terminal — sem redespacho.
        if (ride.source !== 'driver_initiated') {
            if (ride.user?.socketId) {
                sendMessageToSocketId(ride.user.socketId, {
                    event: 'ride-cancelled-by-captain',
                    data: { rideId: ride._id }
                });
            }
            if (ride.user?._id) {
                notificationService.sendRideRequeuedToUser(ride.user._id, { rideId: ride._id.toString() }).catch(console.error);
            }
            await dispatchRideToCaptains(ride, {
                pickup: ride.pickup,
                vehicleType: ride.vehicleType,
                TRACE_ID,
                excludeCaptainId: req.captain._id
            });
        } else if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'ride-cancelled-by-captain',
                data: { rideId: ride._id, presential: true }
            });
        }

        announceCaptainAvailable(req.captain, ride);


        return res.status(200).json(toCaptainRideResponse(ride));
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride cannot be cancelled at this stage') {
            return res.status(409).json({ message: 'Não é mais possível cancelar esta corrida.' });
        }
        if (err.code === 'PRESENTIAL_CANCEL_WINDOW_EXPIRED') {
            return res.status(409).json({
                code: err.code,
                message: 'O prazo para cancelar já passou. Use "Finalizar corrida" para encerrar e cobrar.',
            });
        }
        if (err.message === 'Cancellation reason is required at this stage') {
            return res.status(400).json({ message: 'Informe o motivo do cancelamento.' });
        }
        if (err.code === 'CANCELLATION_IN_PROGRESS') {
            return res.status(409).json({ code: err.code, message: 'Cancelamento já está sendo processado.' });
        }
        if (err.code === 'CANCELLATION_RETRY_REQUIRED') {
            return res.status(503).json({ code: err.code, message: 'O cancelamento financeiro está pendente. Tente novamente.' });
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

        // Invalida cache de histórico do usuário
        deleteByPrefix(`history:${req.user._id}`);

        return res.status(200).json(toRidePassengerDTO(ride));
    } catch (err) {
        if (err.message === 'Ride not found') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        if (err.message === 'Ride cannot be cancelled at this stage') {
            return res.status(409).json({ message: 'Não é mais possível cancelar esta corrida.' });
        }
        if (err.code === 'CANCELLATION_IN_PROGRESS') {
            return res.status(409).json({ code: err.code, message: 'Cancelamento já está sendo processado.' });
        }
        if (err.code === 'CANCELLATION_RETRY_REQUIRED') {
            return res.status(503).json({ code: err.code, message: 'O cancelamento financeiro está pendente. Tente novamente.' });
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
