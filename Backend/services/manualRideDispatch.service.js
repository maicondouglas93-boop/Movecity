const Ride = require('../models/ride.model');
const adminService = require('./admin.service');
const { OFFER_HIGHLIGHT_TTL_MS, computeOfferExpiresAt } = require('../config/offerPolicy');

function manualDispatchState(ride, now = new Date()) {
    const expiresAt = computeOfferExpiresAt(ride);
    const waiting = ride?.source === 'admin'
        && ride?.status === 'requested'
        && !ride?.captain;

    return {
        rideId: ride?._id?.toString?.() || String(ride?._id || ''),
        status: ride?.status,
        captainId: ride?.captain?._id?.toString?.() || ride?.captain?.toString?.() || null,
        offerExpiresAt: expiresAt,
        canRelaunch: Boolean(waiting && expiresAt && expiresAt.getTime() <= new Date(now).getTime()),
    };
}

function manualRideResponse(ride, manualDispatch = {}) {
    const doc = ride?.toObject ? ride.toObject() : ride;
    const state = manualDispatchState(doc);
    return {
        ...doc,
        offerExpiresAt: state.offerExpiresAt,
        manualDispatch: { ...manualDispatch, ...state },
    };
}

function httpError(statusCode, message, code, dispatchState) {
    return Object.assign(new Error(message), { statusCode, code, dispatchState });
}

async function findManualRide(rideId, { includeOtp = false } = {}) {
    let query = Ride.findOne({ _id: rideId, source: 'admin' });
    if (includeOtp) query = query.select('+otp');
    return query.populate('user captain createdBy', 'fullname phone name');
}

async function getManualDispatchStatus(rideId) {
    const ride = await findManualRide(rideId);
    if (!ride) {
        throw httpError(404, 'Corrida lançada pelo painel não encontrada.', 'MANUAL_RIDE_NOT_FOUND');
    }
    return manualDispatchState(ride);
}

async function relaunchManualRide({ rideId, admin, ip }) {
    const current = await findManualRide(rideId);
    if (!current) {
        throw httpError(404, 'Corrida lançada pelo painel não encontrada.', 'MANUAL_RIDE_NOT_FOUND');
    }

    const currentState = manualDispatchState(current);
    if (current.status !== 'requested' || current.captain) {
        throw httpError(
            409,
            'Esta corrida já não está aguardando motorista.',
            'MANUAL_RIDE_NOT_WAITING',
            currentState,
        );
    }
    if (!currentState.canRelaunch) {
        throw httpError(
            409,
            'A oferta ainda está ativa. Aguarde o tempo terminar para lançar novamente.',
            'MANUAL_RIDE_OFFER_ACTIVE',
            currentState,
        );
    }

    const previousAttemptAt = current.dispatchLastAttemptAt || current.activatedAt || current.createdAt;
    const now = new Date();
    const cutoff = new Date(now.getTime() - OFFER_HIGHLIGHT_TTL_MS);
    const leaseUntil = new Date(now.getTime() + 30_000);
    const claimed = await Ride.findOneAndUpdate(
        {
            _id: rideId,
            source: 'admin',
            status: 'requested',
            captain: null,
            $and: [
                {
                    $or: [
                        { dispatchLeaseUntil: null },
                        { dispatchLeaseUntil: { $exists: false } },
                        { dispatchLeaseUntil: { $lte: now } },
                    ],
                },
                {
                    $or: [
                        { dispatchLastAttemptAt: { $lte: cutoff } },
                        { dispatchLastAttemptAt: null, createdAt: { $lte: cutoff } },
                        { dispatchLastAttemptAt: { $exists: false }, createdAt: { $lte: cutoff } },
                    ],
                },
            ],
        },
        {
            $set: {
                dispatchLastAttemptAt: now,
                dispatchLeaseUntil: leaseUntil,
                dispatchLastError: null,
            },
            $inc: { dispatchAttempts: 1 },
        },
        { new: true },
    );

    if (!claimed) {
        const fresh = await findManualRide(rideId);
        const freshState = fresh ? manualDispatchState(fresh) : null;
        throw httpError(
            409,
            fresh?.status !== 'requested' || fresh?.captain
                ? 'Esta corrida já não está aguardando motorista.'
                : 'Esta corrida acabou de ser lançada novamente por outro administrador.',
            'MANUAL_RIDE_RELAUNCH_CONFLICT',
            freshState,
        );
    }

    let offeredCount = 0;
    try {
        const { dispatchRideToCaptains } = require('../controllers/ride.controller');
        offeredCount = await dispatchRideToCaptains(claimed, {
            pickup: claimed.pickup,
            vehicleType: claimed.vehicleType,
            TRACE_ID: `AdminRideRelaunch:${claimed._id}`,
            pickupCoordinates: claimed.pickupCoordinates,
        });

        await Ride.updateOne(
            { _id: claimed._id },
            {
                $set: {
                    dispatchLeaseUntil: null,
                    dispatchLastError: offeredCount > 0 ? null : 'no_captains',
                },
            },
        );
    } catch (error) {
        await Ride.updateOne(
            { _id: claimed._id },
            {
                $set: {
                    dispatchLastAttemptAt: previousAttemptAt,
                    dispatchLeaseUntil: null,
                    dispatchLastError: error.message || 'dispatch_failed',
                },
            },
        ).catch(() => {});
        throw httpError(502, 'Não foi possível reenviar a corrida aos motoristas. Tente novamente.', 'MANUAL_RIDE_RELAUNCH_FAILED');
    }

    await adminService.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'relaunch_manual_ride',
        targetId: claimed._id.toString(),
        targetModel: 'Ride',
        reason: 'Oferta expirada sem aceite; corrida lançada novamente pelo painel',
        ipAddress: ip || '0.0.0.0',
        newValue: { offeredCount, dispatchLastAttemptAt: now },
    });

    const result = await findManualRide(rideId, { includeOtp: true });
    return manualRideResponse(result, { relaunched: true, offeredCount });
}

module.exports = {
    manualDispatchState,
    manualRideResponse,
    getManualDispatchStatus,
    relaunchManualRide,
};
