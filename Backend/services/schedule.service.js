const cron = require('node-cron');
const rideModel = require('../models/ride.model');
const parcelModel = require('../models/parcel.model');
const captainModel = require('../models/captain.model');
const mapService = require('./maps.service');
const dispatchService = require('./dispatch.service');

const MIN_AHEAD_MS = 15 * 60 * 1000;
const MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** Começa a buscar motorista X minutos antes do horário marcado. */
const ACTIVATE_AHEAD_MS = 10 * 60 * 1000;
const CAPTAIN_HORIZON_MS = 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 20;
/** SCH-A2 Fase 2: rodadas de despacho com 0 captains antes de cancelar (cron ~1/min). */
const MAX_DISPATCH_ROUNDS = 6;

function assertValidScheduledAt(scheduledAt) {
    const at = new Date(scheduledAt);
    if (Number.isNaN(at.getTime())) {
        const err = new Error('INVALID_SCHEDULED_AT');
        err.code = 'INVALID_SCHEDULED_AT';
        throw err;
    }
    const delta = at.getTime() - Date.now();
    if (delta < MIN_AHEAD_MS) {
        const err = new Error('SCHEDULE_TOO_SOON');
        err.code = 'SCHEDULE_TOO_SOON';
        throw err;
    }
    if (delta > MAX_AHEAD_MS) {
        const err = new Error('SCHEDULE_TOO_FAR');
        err.code = 'SCHEDULE_TOO_FAR';
        throw err;
    }
    return at;
}

module.exports.assertValidScheduledAt = assertValidScheduledAt;
module.exports.MAX_DISPATCH_ROUNDS = MAX_DISPATCH_ROUNDS;

/** Endereço resumido para upcoming — sem PII extra. */
function shortAddress(address) {
    if (!address) return '';
    const clean = String(address).replace(/\s*\(-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\)\s*$/, '');
    return clean.split(',')[0].trim();
}

function sanitizeDispatchError(err) {
    const msg = err?.message || String(err);
    return String(msg)
        .replace(/\+?\d{10,15}/g, '[redacted]')
        .slice(0, 200);
}

function scheduleLog(event, fields = {}) {
    console.log(JSON.stringify({ tag: 'SCHEDULE', event, ts: new Date().toISOString(), ...fields }));
}

async function emitScheduleSocket(userId, event, data) {
    if (!userId) return;
    try {
        const userModel = require('../models/user.model');
        const { sendMessageToSocketId } = require('../socket');
        const user = await userModel.findById(userId).select('socketId');
        if (user?.socketId) {
            sendMessageToSocketId(user.socketId, { event, data });
        }
    } catch (err) {
        console.error('[SCHEDULE] socket emit failed:', err.message);
    }
}

function notifyScheduleActivated(doc, kind) {
    try {
        const notificationService = require('./notification.service');
        const id = doc._id?.toString();
        notificationService.sendScheduleActivated(doc.user, { kind, id, rideId: kind === 'ride' ? id : undefined, parcelId: kind === 'parcel' ? id : undefined });
        emitScheduleSocket(doc.user, 'schedule-activated', { kind, id, status: doc.status });
    } catch (err) {
        console.error('[SCHEDULE] notify activated failed:', err.message);
    }
}

function notifyScheduleTerminalCancel(doc, kind, reason) {
    try {
        const notificationService = require('./notification.service');
        const id = doc._id?.toString();
        const message = reason === 'dispatch_failed'
            ? 'Houve uma falha ao buscar motorista para seu agendamento. Remarque quando quiser.'
            : undefined;
        notificationService.sendScheduleNoDriver(doc.user, {
            kind,
            id,
            reason,
            message,
            rideId: kind === 'ride' ? id : undefined,
            parcelId: kind === 'parcel' ? id : undefined,
        });
        emitScheduleSocket(doc.user, 'schedule-cancelled', { kind, id, reason });
    } catch (err) {
        console.error('[SCHEDULE] notify no_driver failed:', err.message);
    }
}

async function cancelRideSystem(rideId, reason, extraSet = {}) {
    const updated = await rideModel.findOneAndUpdate(
        { _id: rideId, status: { $in: ['scheduled', 'requested'] } },
        {
            $set: {
                status: 'cancelled',
                cancelledBy: 'system',
                cancellationReason: reason,
                cancelledAt: new Date(),
                ...extraSet,
            },
        },
        { new: true }
    );
    if (updated) {
        scheduleLog(reason === 'no_drivers' ? 'no_drivers_final' : 'dispatch_failed_final', {
            kind: 'ride',
            id: String(rideId),
            reason,
        });
        notifyScheduleTerminalCancel(updated, 'ride', reason);
    }
    return updated;
}

async function cancelParcelSystemNoDrivers(parcelId, reason, extraSet = {}) {
    const parcelService = require('./parcel.service');
    const updated = await parcelService.cancelParcelSystem(parcelId, reason);
    if (updated && Object.keys(extraSet).length) {
        await parcelModel.updateOne({ _id: parcelId }, { $set: extraSet });
    }
    if (updated) {
        scheduleLog(reason === 'no_drivers' ? 'no_drivers_final' : 'dispatch_failed_final', {
            kind: 'parcel',
            id: String(parcelId),
            reason,
        });
        notifyScheduleTerminalCancel(updated, 'parcel', reason);
    }
    return updated;
}

/** Exception no dispatch: reverte para scheduled (retry) ou cancela se esgotou rounds. */
async function rollbackRideDispatch(rideId, err) {
    const current = await rideModel.findById(rideId).select('status dispatchAttempts');
    if (!current || current.status !== 'requested') return;

    const nextAttempts = (current.dispatchAttempts || 0) + 1;
    const errMsg = sanitizeDispatchError(err);

    if (nextAttempts >= MAX_DISPATCH_ROUNDS) {
        await cancelRideSystem(rideId, 'dispatch_failed', {
            dispatchAttempts: nextAttempts,
            dispatchLastError: errMsg,
            activatedAt: null,
        });
        return;
    }

    await rideModel.findOneAndUpdate(
        { _id: rideId, status: 'requested' },
        {
            $set: {
                status: 'scheduled',
                activatedAt: null,
                dispatchLastError: errMsg,
            },
            $inc: { dispatchAttempts: 1 },
        }
    );
    scheduleLog('reverted', { kind: 'ride', id: String(rideId), reason: 'dispatch_exception' });
}

async function rollbackParcelDispatch(parcelId, err) {
    const current = await parcelModel.findById(parcelId).select('status dispatchAttempts');
    if (!current || current.status !== 'awaiting_provider') return;

    const nextAttempts = (current.dispatchAttempts || 0) + 1;
    const errMsg = sanitizeDispatchError(err);

    if (nextAttempts >= MAX_DISPATCH_ROUNDS) {
        await cancelParcelSystemNoDrivers(parcelId, 'dispatch_failed', {
            dispatchAttempts: nextAttempts,
            dispatchLastError: errMsg,
            activatedAt: null,
        });
        return;
    }

    await parcelModel.findOneAndUpdate(
        { _id: parcelId, status: 'awaiting_provider' },
        {
            $set: {
                status: 'scheduled',
                activatedAt: null,
                dispatchLastError: errMsg,
            },
            $inc: { dispatchAttempts: 1 },
            $push: {
                statusHistory: { status: 'scheduled', at: new Date(), by: 'system' },
            },
        }
    );
    scheduleLog('reverted', { kind: 'parcel', id: String(parcelId), reason: 'dispatch_exception' });
}

/** 0 captains: incrementa attempts; cancela com no_drivers ao esgotar. */
async function handleZeroCaptainsRide(rideId) {
    const updated = await rideModel.findOneAndUpdate(
        {
            _id: rideId,
            status: 'requested',
            $or: [{ captain: null }, { captain: { $exists: false } }],
        },
        {
            $inc: { dispatchAttempts: 1 },
            $set: { dispatchLastError: 'no_captains' },
        },
        { new: true }
    );
    if (!updated) return { cancelled: false };
    if (updated.dispatchAttempts >= MAX_DISPATCH_ROUNDS) {
        await cancelRideSystem(rideId, 'no_drivers');
        return { cancelled: true, attempts: updated.dispatchAttempts };
    }
    return { cancelled: false, attempts: updated.dispatchAttempts };
}

async function handleZeroCaptainsParcel(parcelId) {
    const updated = await parcelModel.findOneAndUpdate(
        {
            _id: parcelId,
            status: 'awaiting_provider',
            $or: [{ captain: null }, { captain: { $exists: false } }],
        },
        {
            $inc: { dispatchAttempts: 1 },
            $set: { dispatchLastError: 'no_captains' },
        },
        { new: true }
    );
    if (!updated) return { cancelled: false };
    if (updated.dispatchAttempts >= MAX_DISPATCH_ROUNDS) {
        await cancelParcelSystemNoDrivers(parcelId, 'no_drivers');
        return { cancelled: true, attempts: updated.dispatchAttempts };
    }
    return { cancelled: false, attempts: updated.dispatchAttempts };
}

/**
 * SCH-M3: lista inclui scheduled e pós-activate pré-aceite
 * (requested / awaiting_provider com scheduledAt).
 */
module.exports.listUserScheduled = async (userId) => {
    const [rides, parcels] = await Promise.all([
        rideModel.find({
            user: userId,
            scheduledAt: { $ne: null },
            status: { $in: ['scheduled', 'requested'] },
        })
            .sort({ scheduledAt: 1 })
            .lean(),
        parcelModel.find({
            user: userId,
            scheduledAt: { $ne: null },
            status: { $in: ['scheduled', 'awaiting_provider'] },
        })
            .sort({ scheduledAt: 1 })
            .lean(),
    ]);

    const items = [
        ...rides.map((r) => ({
            kind: 'ride',
            _id: r._id,
            pickup: r.pickup,
            destination: r.destination,
            fare: r.finalPrice || r.fare,
            vehicleType: r.vehicleType,
            paymentMethod: r.paymentMethod,
            scheduledAt: r.scheduledAt,
            status: r.status,
            createdAt: r.createdAt,
        })),
        ...parcels.map((p) => ({
            kind: 'parcel',
            _id: p._id,
            pickup: p.pickup,
            destination: p.destination,
            fare: p.fare,
            vehicleType: p.vehicleType,
            paymentMethod: p.paymentMethod,
            itemName: p.itemName,
            scheduledAt: p.scheduledAt || p.schedule?.at,
            status: p.status,
            createdAt: p.createdAt,
        })),
    ].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

    return items;
};

module.exports.cancelUserScheduled = async ({ userId, kind, id }) => {
    if (kind === 'ride') {
        const updated = await rideModel.findOneAndUpdate(
            {
                _id: id,
                user: userId,
                scheduledAt: { $ne: null },
                status: { $in: ['scheduled', 'requested'] },
            },
            {
                $set: {
                    status: 'cancelled',
                    cancelledBy: 'passenger',
                    cancellationReason: 'scheduled_cancelled',
                    cancelledAt: new Date(),
                },
            },
            { new: true }
        );
        if (!updated) {
            const err = new Error('SCHEDULED_NOT_FOUND');
            err.code = 'SCHEDULED_NOT_FOUND';
            throw err;
        }
        return { kind: 'ride', item: updated };
    }

    if (kind === 'parcel') {
        const updated = await parcelModel.findOneAndUpdate(
            {
                _id: id,
                user: userId,
                scheduledAt: { $ne: null },
                status: { $in: ['scheduled', 'awaiting_provider'] },
            },
            {
                $set: {
                    status: 'cancelled',
                    cancelledBy: 'passenger',
                    cancellationReason: 'scheduled_cancelled',
                    cancelledAt: new Date(),
                },
                $push: {
                    statusHistory: { status: 'cancelled', at: new Date(), by: 'user' },
                },
            },
            { new: true }
        );
        if (!updated) {
            const err = new Error('SCHEDULED_NOT_FOUND');
            err.code = 'SCHEDULED_NOT_FOUND';
            throw err;
        }
        return { kind: 'parcel', item: updated };
    }

    const err = new Error('INVALID_KIND');
    err.code = 'INVALID_KIND';
    throw err;
};

/**
 * SCH-C3: upcoming filtrado por elegibilidade do motorista (não dump global).
 * DTO sem telefone/nome/PII do passageiro.
 */
module.exports.listCaptainUpcoming = async (captainId) => {
    if (!captainId) return [];

    const captain = await captainModel.findById(captainId)
        .select('location vehicle isOnline isBlocked canReceiveRides approvalStatus')
        .lean();

    if (!captain) return [];
    if (captain.isOnline !== true) return [];
    if (captain.isBlocked === true) return [];
    if (captain.canReceiveRides === false) return [];
    if (captain.approvalStatus !== 'aprovado') return [];

    const vehicleType = captain.vehicle?.vehicleType;
    if (!vehicleType || !['moto', 'car'].includes(vehicleType)) return [];

    const pos = captain.location;
    if (pos?.ltd == null || pos?.lng == null) return [];

    const until = new Date(Date.now() + CAPTAIN_HORIZON_MS);
    const from = new Date(Date.now() - 5 * 60 * 1000);
    const radiusKm = dispatchService.CAPTAIN_SEARCH_RADIUS_KM;

    const [rides, parcels] = await Promise.all([
        rideModel.find({
            status: 'scheduled',
            vehicleType,
            scheduledAt: { $gte: from, $lte: until },
            'pickupCoordinates.lat': { $exists: true, $ne: null },
            'pickupCoordinates.lng': { $exists: true, $ne: null },
        }).sort({ scheduledAt: 1 }).limit(60).lean(),
        parcelModel.find({
            status: 'scheduled',
            vehicleType,
            scheduledAt: { $gte: from, $lte: until },
            'pickupCoordinates.lat': { $exists: true, $ne: null },
            'pickupCoordinates.lng': { $exists: true, $ne: null },
        }).sort({ scheduledAt: 1 }).limit(60).lean(),
    ]);

    const withinRadius = (pickupCoordinates) => {
        const lat = pickupCoordinates?.lat;
        const lng = pickupCoordinates?.lng;
        if (lat == null || lng == null) return false;
        return mapService.haversineKm(pos.ltd, pos.lng, lat, lng) <= radiusKm;
    };

    const { computeDriverAmount } = require('../utils/financePrivacy');
    const items = [
        ...rides.filter((r) => withinRadius(r.pickupCoordinates)).map((r) => {
            const driverAmount = computeDriverAmount(r);
            return {
                kind: 'ride',
                _id: r._id,
                pickup: shortAddress(r.pickup),
                destination: shortAddress(r.destination),
                // Motorista: só líquido (sem bruto/comissão).
                fare: driverAmount,
                driverAmount,
                vehicleType: r.vehicleType,
                scheduledAt: r.scheduledAt,
                estimatedDistance: r.estimatedDistance,
                estimatedTime: r.estimatedTime,
            };
        }),
        ...parcels.filter((p) => withinRadius(p.pickupCoordinates)).map((p) => {
            const driverAmount = computeDriverAmount(p);
            return {
                kind: 'parcel',
                _id: p._id,
                pickup: shortAddress(p.pickup),
                destination: shortAddress(p.destination),
                fare: driverAmount,
                driverAmount,
                vehicleType: p.vehicleType,
                itemName: p.itemName,
                size: p.size,
                scheduledAt: p.scheduledAt || p.schedule?.at,
                estimatedDistance: p.estimatedDistance,
                estimatedTime: p.estimatedTime,
            };
        }),
    ]
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
        .slice(0, UPCOMING_LIMIT);

    return items;
};

async function activateDueRides() {
    const cutoff = new Date(Date.now() + ACTIVATE_AHEAD_MS);
    const due = await rideModel.find({
        status: 'scheduled',
        scheduledAt: { $lte: cutoff },
    }).sort({ scheduledAt: 1 }).limit(20);

    if (!due.length) return { activated: 0, dispatch_count: 0 };

    const rideController = require('../controllers/ride.controller');
    let activated = 0;
    let dispatch_count = 0;
    for (const ride of due) {
        const now = new Date();
        const claimed = await rideModel.findOneAndUpdate(
            { _id: ride._id, status: 'scheduled' },
            { $set: { status: 'requested', activatedAt: now } },
            { new: true }
        );
        if (!claimed) continue;
        notifyScheduleActivated(claimed, 'ride');
        scheduleLog('activated', { kind: 'ride', id: String(claimed._id) });
        try {
            // Fase 4: liquida wallet/cupom/payment na ativação (não no booking).
            const rideService = require('./ride.service');
            await rideService.settleScheduledRideFinance(claimed._id);
        } catch (financeErr) {
            console.error(`[SCHEDULE] finance settle ride ${claimed._id}:`, financeErr.message);
        }
        try {
            const TRACE_ID = `Ride:${claimed._id}`;
            const offered = await rideController.dispatchRideToCaptains(claimed, {
                pickup: claimed.pickup,
                vehicleType: claimed.vehicleType,
                TRACE_ID,
            });
            dispatch_count += 1;
            scheduleLog('dispatch_count', { kind: 'ride', id: String(claimed._id), offered });
            if (offered === 0) {
                await handleZeroCaptainsRide(claimed._id);
            }
            activated += 1;
        } catch (err) {
            console.error(`[SCHEDULE] Falha ao despachar corrida ${claimed._id}:`, err.message);
            await rollbackRideDispatch(claimed._id, err);
        }
    }
    return { activated, dispatch_count };
}

async function activateDueParcels() {
    const cutoff = new Date(Date.now() + ACTIVATE_AHEAD_MS);
    const due = await parcelModel.find({
        status: 'scheduled',
        scheduledAt: { $lte: cutoff },
    }).sort({ scheduledAt: 1 }).limit(20);

    if (!due.length) return { activated: 0, dispatch_count: 0 };

    const parcelController = require('../controllers/parcel.controller');
    let activated = 0;
    let dispatch_count = 0;
    for (const parcel of due) {
        const now = new Date();
        const claimed = await parcelModel.findOneAndUpdate(
            { _id: parcel._id, status: 'scheduled' },
            {
                $set: { status: 'awaiting_provider', activatedAt: now },
                $push: {
                    statusHistory: { status: 'awaiting_provider', at: now, by: 'system' },
                },
            },
            { new: true }
        );
        if (!claimed) continue;
        notifyScheduleActivated(claimed, 'parcel');
        scheduleLog('activated', { kind: 'parcel', id: String(claimed._id) });
        try {
            const TRACE_ID = `Parcel:${claimed._id}`;
            const offered = await parcelController.dispatchParcelToCaptains(claimed, {
                pickup: claimed.pickup,
                vehicleType: claimed.vehicleType,
                TRACE_ID,
            });
            dispatch_count += 1;
            scheduleLog('dispatch_count', { kind: 'parcel', id: String(claimed._id), offered });
            if (offered === 0) {
                await handleZeroCaptainsParcel(claimed._id);
            }
            activated += 1;
        } catch (err) {
            console.error(`[SCHEDULE] Falha ao despachar encomenda ${claimed._id}:`, err.message);
            await rollbackParcelDispatch(claimed._id, err);
        }
    }
    return { activated, dispatch_count };
}

/** Redispatch de agendadas já ativadas ainda sem motorista (SCH-A2). */
async function redispatchOpenScheduledRides() {
    // Evita contar 2 rounds no mesmo tick do cron que acabou de ativar.
    const staleBefore = new Date(Date.now() - 45 * 1000);
    const open = await rideModel.find({
        status: 'requested',
        scheduledAt: { $ne: null },
        activatedAt: { $ne: null, $lte: staleBefore },
        $or: [{ captain: null }, { captain: { $exists: false } }],
        dispatchAttempts: { $lt: MAX_DISPATCH_ROUNDS },
    }).sort({ scheduledAt: 1 }).limit(20);

    if (!open.length) return 0;

    const rideController = require('../controllers/ride.controller');
    let retried = 0;
    for (const ride of open) {
        try {
            const rideService = require('./ride.service');
            await rideService.settleScheduledRideFinance(ride._id);
        } catch (financeErr) {
            console.error(`[SCHEDULE] finance settle retry ride ${ride._id}:`, financeErr.message);
        }
        try {
            const TRACE_ID = `RideRetry:${ride._id}`;
            const offered = await rideController.dispatchRideToCaptains(ride, {
                pickup: ride.pickup,
                vehicleType: ride.vehicleType,
                TRACE_ID,
            });
            if (offered === 0) {
                await handleZeroCaptainsRide(ride._id);
            }
            retried += 1;
        } catch (err) {
            console.error(`[SCHEDULE] Redispatch ride ${ride._id}:`, err.message);
            await rollbackRideDispatch(ride._id, err);
        }
    }
    return retried;
}

async function redispatchOpenScheduledParcels() {
    const staleBefore = new Date(Date.now() - 45 * 1000);
    const open = await parcelModel.find({
        status: 'awaiting_provider',
        scheduledAt: { $ne: null },
        activatedAt: { $ne: null, $lte: staleBefore },
        $or: [{ captain: null }, { captain: { $exists: false } }],
        dispatchAttempts: { $lt: MAX_DISPATCH_ROUNDS },
    }).sort({ scheduledAt: 1 }).limit(20);

    if (!open.length) return 0;

    const parcelController = require('../controllers/parcel.controller');
    let retried = 0;
    for (const parcel of open) {
        try {
            const TRACE_ID = `ParcelRetry:${parcel._id}`;
            const offered = await parcelController.dispatchParcelToCaptains(parcel, {
                pickup: parcel.pickup,
                vehicleType: parcel.vehicleType,
                TRACE_ID,
            });
            if (offered === 0) {
                await handleZeroCaptainsParcel(parcel._id);
            }
            retried += 1;
        } catch (err) {
            console.error(`[SCHEDULE] Redispatch parcel ${parcel._id}:`, err.message);
            await rollbackParcelDispatch(parcel._id, err);
        }
    }
    return retried;
}

module.exports.activateDueRides = activateDueRides;
module.exports.activateDueParcels = activateDueParcels;
module.exports.redispatchOpenScheduledRides = redispatchOpenScheduledRides;
module.exports.redispatchOpenScheduledParcels = redispatchOpenScheduledParcels;

module.exports.activateDueSchedules = async () => {
    const rides = await activateDueRides();
    const parcels = await activateDueParcels();
    const rideRetries = await redispatchOpenScheduledRides();
    const parcelRetries = await redispatchOpenScheduledParcels();
    const summary = {
        rides: rides.activated,
        parcels: parcels.activated,
        rideRetries,
        parcelRetries,
        dispatch_count: (rides.dispatch_count || 0) + (parcels.dispatch_count || 0),
    };
    scheduleLog('cron_tick', summary);
    return summary;
};

// Operação multi-instância (Fase 3.4): MVP usa CAS por documento (findOneAndUpdate
// status:'scheduled'). Não há lock Redis `schedule:cron` — o projeto não usa Redis
// de coordenação em produção hoje. Restrição operacional: preferir single web dyno
// para o cron; com scale-out, o CAS evita double-activate do mesmo doc, mas o
// redispatch pode rodar em paralelo em N instâncias (aceitável até haver Redis).
if (process.env.NODE_ENV !== 'test') {
    cron.schedule('* * * * *', () => {
        module.exports.activateDueSchedules().catch((err) => {
            console.error('[SCHEDULE] cron error:', err.message);
        });
    });
}
