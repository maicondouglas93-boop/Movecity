const { validationResult } = require('express-validator');
const parcelService = require('../services/parcel.service');
const dispatchService = require('../services/dispatch.service');
const parcelModel = require('../models/parcel.model');
const { sendMessageToSocketId, addSocketToRoom, sendMessageToRoom, emitDriverMapUpdate } = require('../socket');
const notificationService = require('../services/notification.service');

async function dispatchParcelToCaptains(parcel, { pickup, vehicleType, TRACE_ID, excludeCaptainId } = {}) {
    const { pickupCoordinates, captains } = await dispatchService.findCaptainsNearPickup(
        pickup,
        vehicleType,
        {
            TRACE_ID,
            excludeCaptainId,
            excludeActiveRide: true,
            excludeActiveParcel: true,
            serviceKind: parcel.scheduledAt ? 'scheduledParcel' : 'parcel',
        }
    );

    const parcelWithUser = await parcelModel.findOneAndUpdate(
        { _id: parcel._id },
        { pickupCoordinates },
        { new: true }
    ).populate('user');

    const offerPayload = parcelService.toParcelOfferDTO(parcelWithUser);

    captains.forEach((captain) => {
        addSocketToRoom(captain.socketId, `parcel_${parcel._id}`);
        sendMessageToSocketId(captain.socketId, {
            event: 'new-parcel',
            data: offerPayload,
        });
        if (typeof notificationService.sendNewParcel === 'function') {
            notificationService.sendNewParcel(captain._id, {
                parcelId: parcelWithUser._id.toString(),
                fare: parcelWithUser.fare,
                pickup: parcelWithUser.pickup,
                destination: parcelWithUser.destination,
                estimatedDistance: parcelWithUser.estimatedDistance,
                estimatedTime: parcelWithUser.estimatedTime,
                vehicleType: parcelWithUser.vehicleType,
                itemName: parcelWithUser.itemName,
                size: parcelWithUser.size,
                isScheduled: Boolean(parcelWithUser.scheduledAt),
                scheduledAt: parcelWithUser.scheduledAt,
                // Auditoria PWA (2026-08-07, P1): mesma âncora do socket (offerPayload já
                // computou via toParcelOfferDTO) — reaproveitado, não recalculado.
                offerExpiresAt: offerPayload.offerExpiresAt?.toISOString?.() || offerPayload.offerExpiresAt,
            }, TRACE_ID).catch(console.error);
        }
    });

    return captains.length;
}

module.exports.getFare = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const { pickup, destination, vehicleType } = req.query;
        const fare = await parcelService.getParcelFare({ pickup, destination, vehicleType });
        const compatibility = await parcelService.validateVehicleCompatibility({
            vehicleType,
            size: req.query.size || 'small',
            weightKg: Number(req.query.weightKg) || 0,
        });
        return res.status(200).json({ ...fare, warnings: compatibility.warnings, blocked: compatibility.blocked });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.createParcel = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const body = req.body || {};
        const { parcel, warnings } = await parcelService.createParcel({
            pickup: body.pickup,
            destination: body.destination,
            vehicleType: body.vehicleType,
            sender: body.sender,
            recipient: body.recipient,
            itemName: body.itemName,
            category: body.category,
            weightKg: body.weightKg,
            size: body.size,
            description: body.description,
            notes: body.notes,
            paymentMethod: body.paymentMethod,
            scheduledAt: body.scheduledAt,
            user: req.user._id,
        });

        const TRACE_ID = `Parcel:${parcel._id}`;
        if (req.user?.socketId) {
            addSocketToRoom(req.user.socketId, `parcel_${parcel._id}`);
        }

        // Agendada: sem despacho agora — o cron ativa perto do horário.
        if (parcel.status === 'scheduled') {
            if (typeof notificationService.sendScheduleCreated === 'function') {
                notificationService.sendScheduleCreated(req.user._id, {
                    kind: 'parcel',
                    id: parcel._id.toString(),
                    parcelId: parcel._id.toString(),
                    scheduledAt: parcel.scheduledAt,
                });
            }
        } else {
            try {
                const offered = await dispatchParcelToCaptains(parcel, {
                    pickup: parcel.pickup,
                    vehicleType: parcel.vehicleType,
                    TRACE_ID,
                });
                if (offered === 0) {
                    await parcelService.cancelParcelSystem(parcel._id, 'no_providers');
                    return res.status(503).json({
                        message: 'Nenhum prestador disponível no momento. Tente novamente em instantes.',
                    });
                }
            } catch (dispatchErr) {
                console.error(`[PARCEL][${TRACE_ID}] dispatch failed:`, dispatchErr.message);
                await parcelService.cancelParcelSystem(parcel._id, 'dispatch_failed');
                return res.status(502).json({ message: 'Falha ao despachar encomenda. Tente novamente.' });
            }
        }

        const withPin = await parcelModel.findById(parcel._id).select('+deliveryPin').populate('captain');
        return res.status(201).json({ ...withPin.toObject(), warnings });
    } catch (err) {
        if (err.code === 'VEHICLE_INCOMPATIBLE') {
            return res.status(400).json({ message: err.message });
        }
        if (err.code === 'USER_HAS_ACTIVE_PARCEL' || err.message === 'USER_HAS_ACTIVE_PARCEL') {
            return res.status(409).json({ message: 'Você já possui uma encomenda em andamento.' });
        }
        if (err.code === 'USER_HAS_ACTIVE_RIDE' || err.message === 'USER_HAS_ACTIVE_RIDE') {
            return res.status(409).json({ message: 'Você já possui uma corrida em andamento.' });
        }
        if (err.code === 'INVALID_PAYMENT_METHOD' || err.message === 'INVALID_PAYMENT_METHOD') {
            return res.status(400).json({ message: 'Forma de pagamento inválida. Use dinheiro ou Pix.' });
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
        console.error('[PARCEL] create error:', err);
        return res.status(500).json({ message: err.message });
    }
};

module.exports.getCurrent = async (req, res) => {
    try {
        const parcel = await parcelService.getCurrentParcelForUser(req.user._id);
        if (!parcel) return res.status(200).json(parcel);
        const requireDeliveryPin = await parcelService.getRequireDeliveryPin(parcel.vehicleType || 'moto');
        return res.status(200).json({ ...parcel.toObject(), requireDeliveryPin });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.getCurrentForCaptain = async (req, res) => {
    try {
        const parcel = await parcelService.getCurrentParcelForCaptain(req.captain._id);
        return res.status(200).json(parcel ? await parcelService.toParcelCaptainDTO(parcel) : null);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.getPending = async (req, res) => {
    try {
        const parcels = await parcelService.getPendingParcelsForCaptain({ captain: req.captain });
        return res.status(200).json(parcels);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.getCaptainHistory = async (req, res) => {
    try {
        const data = await parcelService.getCaptainParcelHistory({
            captain: req.captain,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports.acceptParcel = async (req, res) => {
    const parcelId = req.params.id;
    const TRACE_ID = `Parcel:${parcelId}`;
    try {
        const parcel = await parcelService.acceptParcelAtomic({
            parcelId,
            captain: req.captain,
        });

        if (parcel.user?.socketId) {
            addSocketToRoom(parcel.user.socketId, `parcel_${parcelId}`);
            sendMessageToSocketId(parcel.user.socketId, {
                event: 'parcel-confirmed',
                data: parcel,
            });
        }
        if (req.captain.socketId) {
            addSocketToRoom(req.captain.socketId, `parcel_${parcelId}`);
        }

        sendMessageToRoom(`parcel_${parcelId}`, {
            event: 'parcel-taken',
            data: { parcelId, captainId: req.captain._id.toString() },
        });

        emitDriverMapUpdate(req.captain._id, { busy: true });

        if (typeof notificationService.sendRideAccepted === 'function' && parcel.user) {
            // Reusa canal de aceite com tipo parcel no payload quando possível.
            notificationService.sendRideAccepted(parcel.user._id || parcel.user, {
                parcelId: String(parcelId),
                subjectType: 'parcel',
            }).catch(() => {});
        }

        return res.status(200).json(await parcelService.toParcelCaptainDTO(parcel));
    } catch (err) {
        console.error(`[AUDIT][${TRACE_ID}] accept fail:`, err.message);
        if (err.message === 'PARCEL_ALREADY_ACCEPTED') {
            return res.status(409).json({ message: 'Encomenda já aceita por outro prestador' });
        }
        if (err.message === 'PARCEL_CANCELLED') {
            return res.status(409).json({ message: 'Encomenda cancelada' });
        }
        if (err.message === 'PARCEL_NOT_FOUND') {
            return res.status(404).json({ message: 'Encomenda não encontrada' });
        }
        if (err.message === 'CAPTAIN_HAS_ACTIVE_RIDE' || err.message === 'CAPTAIN_HAS_ACTIVE_PARCEL') {
            return res.status(409).json({ message: 'Você já está em outro serviço ativo.' });
        }
        if (err.message === 'OUT_OF_RANGE') {
            return res.status(403).json({ message: 'Você está fora da área desta encomenda.' });
        }
        if (err.message === 'CAPTAIN_NOT_ALLOWED' || err.message === 'VEHICLE_MISMATCH') {
            return res.status(403).json({ message: 'Não autorizado a aceitar esta encomenda.' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.declineParcel = async (req, res) => {
    await parcelService.declineParcel({
        parcelId: req.params.id,
        captain: req.captain,
    });
    return res.status(200).json({ ok: true });
};

module.exports.updateStatus = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const parcel = await parcelService.updateParcelStatus({
            parcelId: req.params.id,
            captain: req.captain,
            status: req.body.status,
        });

        const requireDeliveryPin = await parcelService.getRequireDeliveryPin(parcel.vehicleType || 'moto');

        if (parcel.user?.socketId) {
            sendMessageToSocketId(parcel.user.socketId, {
                event: 'parcel-status-updated',
                data: { ...(parcel.toObject ? parcel.toObject() : parcel), requireDeliveryPin },
            });
        }

        return res.status(200).json({ ...(await parcelService.toParcelCaptainDTO(parcel)), requireDeliveryPin });
    } catch (err) {
        if (err.message === 'INVALID_STATUS_TRANSITION') {
            return res.status(400).json({ message: 'Transição de status inválida' });
        }
        if (err.message === 'PARCEL_NOT_FOUND') {
            return res.status(404).json({ message: 'Encomenda não encontrada' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.confirmDelivery = async (req, res) => {
    try {
        const parcel = await parcelService.confirmDelivery({
            parcelId: req.params.id,
            captain: req.captain,
            pin: req.body.pin,
        });

        if (parcel.user?.socketId) {
            sendMessageToSocketId(parcel.user.socketId, {
                event: 'parcel-delivered',
                data: parcel,
            });
            sendMessageToSocketId(parcel.user.socketId, {
                event: 'parcel-ended',
                data: parcel,
            });
        }

        emitDriverMapUpdate(req.captain._id, { busy: false });
        return res.status(200).json(await parcelService.toParcelCaptainDTO(parcel));
    } catch (err) {
        if (err.message === 'INVALID_PIN') {
            return res.status(400).json({ message: 'PIN inválido' });
        }
        if (err.message === 'INVALID_STATUS_FOR_DELIVERY') {
            return res.status(400).json({ message: 'Encomenda não está aguardando confirmação de entrega' });
        }
        if (err.message === 'PARCEL_NOT_FOUND') {
            return res.status(404).json({ message: 'Encomenda não encontrada' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.confirmPayment = async (req, res) => {
    try {
        const parcel = await parcelService.confirmParcelPayment({
            parcelId: req.params.id,
            captain: req.captain,
        });
        return res.status(200).json(await parcelService.toParcelCaptainDTO(parcel));
    } catch (err) {
        if (err.message === 'PARCEL_NOT_FOUND') {
            return res.status(404).json({ message: 'Encomenda não encontrada' });
        }
        if (err.message === 'PARCEL_NOT_FINISHED') {
            return res.status(400).json({ message: 'Finalize a entrega antes de confirmar o pagamento' });
        }
        if (err.message === 'PAYMENT_ALREADY_CONFIRMED') {
            return res.status(409).json({ message: 'Pagamento já confirmado' });
        }
        if (err.message === 'INVALID_PAYMENT_METHOD') {
            return res.status(400).json({ message: 'Forma de pagamento inválida para liquidação' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.cancelParcel = async (req, res) => {
    try {
        const parcel = await parcelService.cancelParcel({
            parcelId: req.params.id || req.body.parcelId,
            user: req.user._id,
            reason: req.body.reason,
        });

        const cancelPayload = {
            event: 'parcel-cancelled',
            data: { parcelId: parcel._id.toString() },
        };

        // Sala: fecha popup dos candidatos do despacho.
        sendMessageToRoom(`parcel_${parcel._id}`, cancelPayload);

        // Direto ao motorista designado (socketId muda a cada reconnect — sala sozinha falha).
        if (parcel.captain?.socketId) {
            sendMessageToSocketId(parcel.captain.socketId, cancelPayload);
        }

        if (parcel.captain) {
            const captainId = parcel.captain._id || parcel.captain;
            emitDriverMapUpdate(captainId, { busy: false });
            if (typeof notificationService.sendRideCancelledToCaptain === 'function') {
                notificationService.sendRideCancelledToCaptain(captainId, {
                    parcelId: parcel._id.toString(),
                    subjectType: 'parcel',
                }).catch(() => {});
            }
        }

        return res.status(200).json(parcel);
    } catch (err) {
        if (err.message === 'PARCEL_NOT_FOUND') {
            return res.status(404).json({ message: 'Encomenda não encontrada' });
        }
        if (err.message === 'PARCEL_NOT_CANCELLABLE') {
            return res.status(400).json({ message: 'Não é possível cancelar neste status' });
        }
        return res.status(500).json({ message: err.message });
    }
};

module.exports.submitReview = async (req, res) => {
    try {
        const review = await parcelService.submitReview({
            parcelId: req.body.parcelId || req.body.subjectId,
            user: req.user._id,
            rating: req.body.rating,
            comment: req.body.comment,
            issueCategory: req.body.issueCategory,
        });
        return res.status(201).json(review);
    } catch (err) {
        if (err.message === 'PARCEL_NOT_FOUND') return res.status(404).json({ message: 'Encomenda não encontrada' });
        if (err.message === 'Parcel already reviewed') return res.status(409).json({ message: err.message });
        if (err.message === 'Only finished parcels can be reviewed') return res.status(400).json({ message: err.message });
        return res.status(500).json({ message: err.message });
    }
};

module.exports.submitCaptainReview = async (req, res) => {
    try {
        const review = await parcelService.submitCaptainReview({
            parcelId: req.body.parcelId || req.body.subjectId,
            captain: req.captain._id,
            rating: req.body.rating,
            comment: req.body.comment,
        });
        return res.status(201).json(review);
    } catch (err) {
        if (err.message === 'PARCEL_NOT_FOUND') return res.status(404).json({ message: 'Encomenda não encontrada' });
        if (err.message === 'Parcel already reviewed') return res.status(409).json({ message: err.message });
        if (err.message === 'Only finished parcels can be reviewed') return res.status(400).json({ message: err.message });
        return res.status(500).json({ message: err.message });
    }
};

module.exports.skipReview = async (req, res) => {
    try {
        const parcel = await parcelService.skipPassengerReview({
            parcelId: req.params.id,
            user: req.user._id,
        });
        return res.status(200).json({ ok: true, parcelId: parcel._id });
    } catch (err) {
        if (err.message === 'PARCEL_NOT_FOUND') return res.status(404).json({ message: 'Encomenda não encontrada' });
        return res.status(500).json({ message: err.message });
    }
};

module.exports.skipCaptainReview = async (req, res) => {
    try {
        const parcel = await parcelService.skipCaptainReview({
            parcelId: req.params.id,
            captain: req.captain._id,
        });
        return res.status(200).json({ ok: true, parcelId: parcel._id });
    } catch (err) {
        if (err.message === 'PARCEL_NOT_FOUND') return res.status(404).json({ message: 'Encomenda não encontrada' });
        return res.status(500).json({ message: err.message });
    }
};

module.exports.dispatchParcelToCaptains = dispatchParcelToCaptains;
