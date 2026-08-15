const mongoose = require('mongoose');
const cancellationReconciliationModel = require('../models/cancellationReconciliation.model');
const rideModel = require('../models/ride.model');
const parcelModel = require('../models/parcel.model');
const paymentModel = require('../models/payment.model');
const userModel = require('../models/user.model');
const promotionModel = require('../models/promotion.model');
const promotionUsageModel = require('../models/promotionUsage.model');
const asaasService = require('./asaas.service');
const { getCachedTariffSetting } = require('./tariffSettingCache.service');

const CLAIM_LEASE_MS = 2 * 60 * 1000;

const RIDE_PASSENGER_ORIGINS = [
    'scheduled',
    'requested',
    'accepted',
    'going_to_pickup',
    'arrived',
    'waiting_passenger',
];
const RIDE_FORCE_ORIGINS = [...RIDE_PASSENGER_ORIGINS, 'started'];
const RIDE_CAPTAIN_PRESENTIAL_ORIGINS = [
    'accepted',
    'going_to_pickup',
    'arrived',
    'waiting_passenger',
    'started',
];
const RIDE_FEE_ORIGINS = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'];

const PARCEL_PASSENGER_ORIGINS = [
    'scheduled',
    'awaiting_provider',
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
];
const PARCEL_FORCE_ORIGINS = [
    ...PARCEL_PASSENGER_ORIGINS,
    'collected',
    'in_transit',
    'arrived_destination',
    'delivered',
];

function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cancellationError(code, message = code) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function requestedByString(value) {
    if (!value) return undefined;
    return String(value._id || value);
}

function cancellationExtraSet(extraSet) {
    if (!extraSet || typeof extraSet !== 'object') return {};
    const allowed = [
        'observation',
        'dispatchAttempts',
        'dispatchLastError',
        'dispatchLeaseUntil',
        'activatedAt',
    ];
    return Object.fromEntries(
        allowed
            .filter((key) => Object.prototype.hasOwnProperty.call(extraSet, key))
            .map((key) => [key, extraSet[key]])
    );
}

async function claimCancellation({ subjectType, subjectId, actor, requestedBy, reason }) {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
    let existing = await cancellationReconciliationModel.findOne({ subjectType, subjectId });

    if (existing && ['completed', 'external_pending'].includes(existing.status)) {
        return { reconciliation: existing, replayed: true };
    }
    if (existing?.status === 'processing' && existing.leaseUntil > now) {
        throw cancellationError('CANCELLATION_IN_PROGRESS');
    }

    if (existing) {
        const claimed = await cancellationReconciliationModel.findOneAndUpdate(
            {
                _id: existing._id,
                $or: [
                    { status: 'retry_required' },
                    { status: 'processing', leaseUntil: { $lte: now } },
                    { status: 'processing', leaseUntil: null },
                ],
            },
            {
                $set: {
                    actor,
                    requestedBy: requestedByString(requestedBy),
                    reason,
                    status: 'processing',
                    leaseUntil,
                    lastError: null,
                },
                $inc: { attempts: 1 },
            },
            { new: true }
        );
        if (!claimed) throw cancellationError('CANCELLATION_IN_PROGRESS');
        return { reconciliation: claimed, replayed: false };
    }

    try {
        existing = await cancellationReconciliationModel.create({
            subjectType,
            subjectId,
            actor,
            requestedBy: requestedByString(requestedBy),
            reason,
            status: 'processing',
            attempts: 1,
            leaseUntil,
        });
        return { reconciliation: existing, replayed: false };
    } catch (err) {
        if (err?.code !== 11000) throw err;
        const winner = await cancellationReconciliationModel.findOne({ subjectType, subjectId });
        if (winner && ['completed', 'external_pending'].includes(winner.status)) {
            return { reconciliation: winner, replayed: true };
        }
        throw cancellationError('CANCELLATION_IN_PROGRESS');
    }
}

async function markRetryRequired({ reconciliationId, subjectType, subjectId, error }) {
    const message = String(error?.response?.data?.errors?.[0]?.description || error?.message || error);
    const subjectModel = subjectType === 'ride' ? rideModel : parcelModel;
    await Promise.all([
        cancellationReconciliationModel.updateOne(
            { _id: reconciliationId },
            {
                $set: { status: 'retry_required', lastError: message, leaseUntil: null },
            }
        ),
        subjectModel.updateOne(
            { _id: subjectId },
            { $set: { cancellationReconciliationStatus: 'retry_required' } }
        ),
    ]);
    const retryError = cancellationError('CANCELLATION_RETRY_REQUIRED', 'Cancelamento pendente de reconciliação financeira');
    retryError.cause = error;
    throw retryError;
}

async function releaseRejectedClaim({ reconciliationId, subjectType, subjectId }) {
    const subjectModel = subjectType === 'ride' ? rideModel : parcelModel;
    await Promise.all([
        cancellationReconciliationModel.deleteOne({
            _id: reconciliationId,
            status: 'processing',
        }),
        subjectModel.updateOne(
            { _id: subjectId, cancellationReconciliationStatus: 'processing' },
            { $set: { cancellationReconciliationStatus: 'not_required' } }
        ),
    ]);
}

function refundSummary(remotePayment, expectedValue) {
    const refunds = Array.isArray(remotePayment?.refunds) ? remotePayment.refunds : [];
    const doneValue = roundMoney(refunds
        .filter((refund) => refund.status === 'DONE')
        .reduce((sum, refund) => sum + (Number(refund.value) || 0), 0));
    const pendingValue = roundMoney(refunds
        .filter((refund) => refund.status === 'PENDING')
        .reduce((sum, refund) => sum + (Number(refund.value) || 0), 0));
    const expected = roundMoney(expectedValue);
    const remoteStatus = String(remotePayment?.status || '').toUpperCase();

    return {
        done: remoteStatus === 'REFUNDED' || (expected > 0 && doneValue >= expected),
        pending: pendingValue > 0 || ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS'].includes(remoteStatus),
        doneValue,
        pendingValue,
        receiptUrl: refunds.find((refund) => refund.transactionReceiptUrl)?.transactionReceiptUrl,
    };
}

async function reconcileAsaasPayment({ paymentId, expectedValue, reason }) {
    let remote = await asaasService.getPayment(paymentId);
    let summary = refundSummary(remote, expectedValue);
    if (summary.done) {
        return {
            status: 'completed',
            paymentEffect: 'refunded',
            gateway: {
                name: 'asaas', paymentId, action: 'refund', refundStatus: 'DONE',
                refundValue: summary.doneValue || expectedValue,
                receiptUrl: summary.receiptUrl,
                respondedAt: new Date(),
            },
        };
    }
    if (summary.pending) {
        return {
            status: 'external_pending',
            paymentEffect: 'external_refund_pending',
            gateway: {
                name: 'asaas', paymentId, action: 'refund', refundStatus: 'PENDING',
                refundValue: expectedValue,
                receiptUrl: summary.receiptUrl,
                respondedAt: new Date(),
            },
        };
    }

    const remoteStatus = String(remote?.status || '').toUpperCase();
    const paid = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(remoteStatus);
    if (paid) {
        remote = await asaasService.refundPayment(paymentId, {
            description: `Cancelamento MoveCity: ${reason || 'serviço cancelado'}`,
        });
        summary = refundSummary(remote, expectedValue);
        return {
            status: summary.done ? 'completed' : 'external_pending',
            paymentEffect: summary.done ? 'refunded' : 'external_refund_pending',
            gateway: {
                name: 'asaas', paymentId, action: 'refund',
                refundStatus: summary.done ? 'DONE' : 'PENDING',
                refundValue: summary.doneValue || expectedValue,
                receiptUrl: summary.receiptUrl,
                requestedAt: new Date(),
                respondedAt: new Date(),
            },
        };
    }

    if (remoteStatus !== 'DELETED') {
        await asaasService.deletePayment(paymentId);
    }
    return {
        status: 'completed',
        paymentEffect: 'external_charge_deleted',
        gateway: {
            name: 'asaas', paymentId, action: 'delete', refundStatus: 'NOT_PAID',
            refundValue: 0,
            requestedAt: new Date(),
            respondedAt: new Date(),
        },
    };
}

async function resolveRideGatewayEffect(ride, payment, reason) {
    // `ride.paymentID` foi preenchido com identificadores locais/fabricados em fluxos
    // legados. Só existe efeito externo quando o Payment registra explicitamente o
    // gateway e o id retornado por ele.
    const paymentId = payment?.gatewayTransactionId;
    if (!paymentId) return null;
    const gateway = payment?.gateway;
    if (gateway !== 'asaas') {
        throw cancellationError('UNSUPPORTED_PAYMENT_GATEWAY');
    }
    const expectedValue = Number(payment?.amount || ride.finalPrice || ride.fare) || 0;
    return reconcileAsaasPayment({ paymentId, expectedValue, reason });
}

async function resolveRideCancellationFee(ride, actor) {
    if (actor !== 'passenger' || !ride.captain || !RIDE_FEE_ORIGINS.includes(ride.status)) {
        return 0;
    }
    const snapshot = ride.pricingSnapshot?.tariffSetting;
    if (snapshot && typeof snapshot === 'object') {
        return Math.max(0, Number(snapshot.cancellationFee) || 0);
    }
    const live = await getCachedTariffSetting();
    return Math.max(0, Number(live?.cancellationFee) || 0);
}

function rideOriginsFor(actor, source, allowedOrigins) {
    if (allowedOrigins?.length) return allowedOrigins;
    if (actor === 'passenger') return RIDE_PASSENGER_ORIGINS;
    if (actor === 'captain' && source === 'driver_initiated') return RIDE_CAPTAIN_PRESENTIAL_ORIGINS;
    return RIDE_FORCE_ORIGINS;
}

function paymentStatusForLocalCancellation({ payment, walletRefundAmount, gatewayEffect }) {
    if (gatewayEffect?.paymentEffect === 'refunded') return 'refunded';
    if (gatewayEffect?.paymentEffect === 'external_refund_pending') return 'refund_pending';
    if (gatewayEffect?.paymentEffect === 'external_charge_deleted') return 'cancelled';
    if (walletRefundAmount > 0 && payment?.method === 'carteira') return 'refunded';
    return payment ? 'cancelled' : null;
}

async function finalizeRideCancellation({
    reconciliation,
    actor,
    userId,
    captainId,
    reason,
    allowedOrigins,
    extraSet,
    cancellationFeeAmount,
    gatewayEffect,
}) {
    const safeExtraSet = cancellationExtraSet(extraSet);
    const session = await mongoose.startSession();
    let updatedRide;
    try {
        await session.withTransaction(async () => {
            const ride = await rideModel.findById(reconciliation.subjectId).session(session);
            if (!ride) throw cancellationError('RIDE_NOT_FOUND');
            if (actor === 'passenger' && String(ride.user) !== String(userId)) {
                throw cancellationError('RIDE_NOT_FOUND');
            }
            if (actor === 'captain' && String(ride.captain) !== String(captainId)) {
                throw cancellationError('RIDE_NOT_FOUND');
            }

            const origins = rideOriginsFor(actor, ride.source, allowedOrigins);
            if (ride.status !== 'cancelled' && !origins.includes(ride.status)) {
                throw cancellationError('RIDE_NOT_CANCELLABLE');
            }

            const alreadyRefunded = Number(ride.walletRefundedAmount) || 0;
            // `walletAmountUsed` é o fallback de corridas antigas. Como o schema aplica
            // default 0 ao campo novo durante a hidratação, testar só "isFinite" faria
            // um documento legado parecer explicitamente debitado em zero.
            const originallyDebited = Math.max(
                Number(ride.walletAmountDebited) || 0,
                Number(ride.walletAmountUsed) || 0
            );
            const walletRefundAmount = roundMoney(Math.max(0, originallyDebited - alreadyRefunded));
            if (walletRefundAmount > 0 && ride.user) {
                const walletUpdate = await userModel.updateOne(
                    { _id: ride.user },
                    { $inc: { walletBalance: walletRefundAmount } },
                    { session }
                );
                if (walletUpdate.matchedCount !== 1) {
                    throw cancellationError('CANCELLATION_WALLET_OWNER_NOT_FOUND');
                }
            }

            let promotionReversed = false;
            let promotionDiscountAmount = 0;
            const usage = await promotionUsageModel.findOne({
                rideId: ride._id,
                reversedAt: null,
            }).session(session);
            if (usage) {
                promotionDiscountAmount = Number(usage.discountAmount) || 0;
                const reversed = await promotionUsageModel.findOneAndUpdate(
                    { _id: usage._id, reversedAt: null },
                    {
                        $set: {
                            reversedAt: new Date(),
                            reversalReason: reason || 'service_cancelled',
                            cancellationReconciliationId: reconciliation._id,
                        },
                    },
                    { new: true, session }
                );
                if (reversed) {
                    promotionReversed = true;
                    await promotionModel.updateOne(
                        { _id: usage.promotionId },
                        {
                            $inc: {
                                currentBudgetUsed: -promotionDiscountAmount,
                                'metrics.uses': -1,
                                'metrics.totalDiscountGiven': -promotionDiscountAmount,
                            },
                        },
                        { session }
                    );
                }
            }

            const payment = await paymentModel.findOne({ rideId: ride._id }).session(session);
            const localPaymentStatus = paymentStatusForLocalCancellation({
                payment,
                walletRefundAmount,
                gatewayEffect,
            });
            if (payment && localPaymentStatus) {
                await paymentModel.updateOne(
                    { _id: payment._id },
                    { $set: { status: localPaymentStatus } },
                    { session }
                );
            }

            const reconciliationStatus = gatewayEffect?.status || 'completed';
            const ridePaymentStatus = localPaymentStatus || (
                ride.paymentStatus === 'pending' ? 'cancelled' : ride.paymentStatus
            );
            const wasAlreadyCancelled = ride.status === 'cancelled';
            const setFields = {
                status: 'cancelled',
                cancelledBy: wasAlreadyCancelled ? (ride.cancelledBy || actor) : actor,
                cancellationReason: wasAlreadyCancelled
                    ? (ride.cancellationReason || reason || undefined)
                    : (reason || undefined),
                cancelledAt: ride.cancelledAt || new Date(),
                cancellationFeeCharged: wasAlreadyCancelled
                    ? Math.max(Number(ride.cancellationFeeCharged) || 0, cancellationFeeAmount)
                    : cancellationFeeAmount,
                cancellationReconciliationStatus: reconciliationStatus,
                walletRefundedAmount: alreadyRefunded + walletRefundAmount,
                paymentStatus: ridePaymentStatus,
                ...safeExtraSet,
            };

            if (ride.status === 'cancelled') {
                updatedRide = await rideModel.findOneAndUpdate(
                    { _id: ride._id, status: 'cancelled' },
                    { $set: setFields },
                    { new: true, session }
                );
            } else {
                updatedRide = await rideModel.findOneAndUpdate(
                    { _id: ride._id, status: { $in: origins } },
                    {
                        $set: setFields,
                        $push: { statusHistory: { status: 'cancelled', at: new Date() } },
                    },
                    { new: true, session }
                );
            }
            if (!updatedRide) throw cancellationError('RIDE_NOT_CANCELLABLE');

            const paymentEffect = gatewayEffect?.paymentEffect
                || (payment ? (localPaymentStatus === 'refunded' ? 'refunded' : 'cancelled') : 'none');
            const reconciliationUpdate = await cancellationReconciliationModel.updateOne(
                { _id: reconciliation._id, status: 'processing' },
                {
                    $set: {
                        status: reconciliationStatus,
                        walletRefundAmount,
                        cancellationFeeAmount,
                        promotionReversed,
                        promotionDiscountAmount,
                        paymentEffect,
                        ...(gatewayEffect?.gateway ? { gateway: gatewayEffect.gateway } : {}),
                        leaseUntil: null,
                        lastError: null,
                        ...(reconciliationStatus === 'completed' ? { completedAt: new Date() } : {}),
                    },
                },
                { session }
            );
            if (reconciliationUpdate.matchedCount !== 1) {
                throw cancellationError('CANCELLATION_RECONCILIATION_LOST');
            }
        });
    } finally {
        await session.endSession();
    }
    return rideModel.findById(updatedRide._id).populate('user').populate('captain');
}

module.exports.reconcileRideCancellation = async ({
    rideId,
    actor,
    userId,
    captainId,
    requestedBy,
    reason,
    allowedOrigins,
    extraSet,
}) => {
    const ride = await rideModel.findById(rideId);
    if (!ride) throw cancellationError('RIDE_NOT_FOUND');
    if (actor === 'passenger' && String(ride.user) !== String(userId)) {
        throw cancellationError('RIDE_NOT_FOUND');
    }
    if (actor === 'captain' && String(ride.captain) !== String(captainId)) {
        throw cancellationError('RIDE_NOT_FOUND');
    }
    const origins = rideOriginsFor(actor, ride.source, allowedOrigins);
    if (ride.status !== 'cancelled' && !origins.includes(ride.status)) {
        throw cancellationError('RIDE_NOT_CANCELLABLE');
    }

    const { reconciliation, replayed } = await claimCancellation({
        subjectType: 'ride',
        subjectId: ride._id,
        actor,
        requestedBy: requestedBy || userId || captainId,
        reason,
    });
    if (replayed) {
        return rideModel.findById(ride._id).populate('user').populate('captain');
    }

    await rideModel.updateOne(
        { _id: ride._id },
        { $set: { cancellationReconciliationStatus: 'processing' } }
    );

    let gatewayEffect = null;
    try {
        const payment = await paymentModel.findOne({ rideId: ride._id });
        gatewayEffect = await resolveRideGatewayEffect(ride, payment, reason);
    } catch (error) {
        return markRetryRequired({
            reconciliationId: reconciliation._id,
            subjectType: 'ride',
            subjectId: ride._id,
            error,
        });
    }

    try {
        return await finalizeRideCancellation({
            reconciliation,
            actor,
            userId,
            captainId,
            reason,
            allowedOrigins,
            extraSet,
            cancellationFeeAmount: await resolveRideCancellationFee(ride, actor),
            gatewayEffect,
        });
    } catch (error) {
        if (['RIDE_NOT_FOUND', 'RIDE_NOT_CANCELLABLE'].includes(error.code)) {
            await releaseRejectedClaim({
                reconciliationId: reconciliation._id,
                subjectType: 'ride',
                subjectId: ride._id,
            });
            throw error;
        }
        return markRetryRequired({
            reconciliationId: reconciliation._id,
            subjectType: 'ride',
            subjectId: ride._id,
            error,
        });
    }
};

module.exports.reconcileParcelCancellation = async ({
    parcelId,
    actor,
    userId,
    requestedBy,
    reason,
    allowedOrigins,
    extraSet,
}) => {
    const safeExtraSet = cancellationExtraSet(extraSet);
    const parcel = await parcelModel.findById(parcelId);
    if (!parcel) throw cancellationError('PARCEL_NOT_FOUND');
    if (actor === 'passenger' && String(parcel.user) !== String(userId)) {
        throw cancellationError('PARCEL_NOT_FOUND');
    }
    const origins = allowedOrigins?.length
        ? allowedOrigins
        : (actor === 'passenger' ? PARCEL_PASSENGER_ORIGINS : PARCEL_FORCE_ORIGINS);
    if (parcel.status !== 'cancelled' && !origins.includes(parcel.status)) {
        throw cancellationError('PARCEL_NOT_CANCELLABLE');
    }

    const { reconciliation, replayed } = await claimCancellation({
        subjectType: 'parcel',
        subjectId: parcel._id,
        actor,
        requestedBy: requestedBy || userId,
        reason,
    });
    if (replayed) {
        return parcelModel.findById(parcel._id).populate('user').populate('captain');
    }

    const session = await mongoose.startSession();
    let updatedParcel;
    try {
        await session.withTransaction(async () => {
            const current = await parcelModel.findById(parcel._id).session(session);
            if (!current) throw cancellationError('PARCEL_NOT_FOUND');
            if (actor === 'passenger' && String(current.user) !== String(userId)) {
                throw cancellationError('PARCEL_NOT_FOUND');
            }
            if (current.status !== 'cancelled' && !origins.includes(current.status)) {
                throw cancellationError('PARCEL_NOT_CANCELLABLE');
            }

            const wasAlreadyCancelled = current.status === 'cancelled';
            const setFields = {
                status: 'cancelled',
                cancelledBy: wasAlreadyCancelled ? (current.cancelledBy || actor) : actor,
                cancellationReason: wasAlreadyCancelled
                    ? (current.cancellationReason || reason || '')
                    : (reason || ''),
                cancelledAt: current.cancelledAt || new Date(),
                cancellationReconciliationStatus: 'completed',
                paymentStatus: current.paymentStatus === 'pending' ? 'cancelled' : current.paymentStatus,
                ...safeExtraSet,
            };
            if (current.status === 'cancelled') {
                updatedParcel = await parcelModel.findOneAndUpdate(
                    { _id: current._id, status: 'cancelled' },
                    { $set: setFields },
                    { new: true, session }
                );
            } else {
                updatedParcel = await parcelModel.findOneAndUpdate(
                    { _id: current._id, status: { $in: origins } },
                    {
                        $set: setFields,
                        $push: {
                            statusHistory: {
                                status: 'cancelled',
                                at: new Date(),
                                by: actor === 'passenger' ? 'user' : actor,
                            },
                        },
                    },
                    { new: true, session }
                );
            }
            if (!updatedParcel) throw cancellationError('PARCEL_NOT_CANCELLABLE');

            const reconciliationUpdate = await cancellationReconciliationModel.updateOne(
                { _id: reconciliation._id, status: 'processing' },
                {
                    $set: {
                        status: 'completed',
                        paymentEffect: current.paymentStatus === 'pending' ? 'cancelled' : 'none',
                        completedAt: new Date(),
                        leaseUntil: null,
                        lastError: null,
                    },
                },
                { session }
            );
            if (reconciliationUpdate.matchedCount !== 1) {
                throw cancellationError('CANCELLATION_RECONCILIATION_LOST');
            }
        });
    } catch (error) {
        if (['PARCEL_NOT_FOUND', 'PARCEL_NOT_CANCELLABLE'].includes(error.code)) {
            await releaseRejectedClaim({
                reconciliationId: reconciliation._id,
                subjectType: 'parcel',
                subjectId: parcel._id,
            });
            throw error;
        }
        return markRetryRequired({
            reconciliationId: reconciliation._id,
            subjectType: 'parcel',
            subjectId: parcel._id,
            error,
        });
    } finally {
        await session.endSession();
    }

    return parcelModel.findById(updatedParcel._id).populate('user').populate('captain');
};

module.exports.handleAsaasRefundEvent = async ({ eventId, eventName, payment }) => {
    const paymentId = payment?.id;
    if (!eventId || !paymentId) return false;
    const reconciliation = await cancellationReconciliationModel
        .findOne({ 'gateway.paymentId': paymentId })
        .select('+gatewayEventIds');
    if (!reconciliation) return false;
    if ((reconciliation.gatewayEventIds || []).includes(eventId)) return true;

    const summary = refundSummary(payment, reconciliation.gateway?.refundValue || 0);
    let status = reconciliation.status;
    let paymentStatus;
    let lastError = null;
    if (eventName === 'PAYMENT_REFUND_DENIED') {
        status = 'retry_required';
        paymentStatus = 'failed';
        lastError = 'PAYMENT_REFUND_DENIED';
    } else if (eventName === 'PAYMENT_REFUNDED' || summary.done) {
        status = 'completed';
        paymentStatus = 'refunded';
    } else if (['PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS'].includes(eventName)) {
        status = 'external_pending';
        paymentStatus = 'refund_pending';
    } else {
        return false;
    }

    const update = await cancellationReconciliationModel.findOneAndUpdate(
        { _id: reconciliation._id, gatewayEventIds: { $ne: eventId } },
        {
            $set: {
                status,
                'gateway.refundStatus': status === 'completed' ? 'DONE' : (status === 'retry_required' ? 'DENIED' : 'PENDING'),
                'gateway.refundValue': summary.doneValue || reconciliation.gateway?.refundValue,
                'gateway.receiptUrl': summary.receiptUrl || reconciliation.gateway?.receiptUrl,
                'gateway.respondedAt': new Date(),
                lastError,
                ...(status === 'completed' ? { completedAt: new Date() } : {}),
            },
            $push: { gatewayEventIds: { $each: [eventId], $slice: -50 } },
        },
        { new: true }
    );
    if (!update) return true;

    await Promise.all([
        paymentModel.updateMany(
            { gatewayTransactionId: paymentId },
            { $set: { status: paymentStatus } }
        ),
        reconciliation.subjectType === 'ride'
            ? rideModel.updateOne(
                { _id: reconciliation.subjectId },
                {
                    $set: {
                        paymentStatus,
                        cancellationReconciliationStatus: status,
                    },
                }
            )
            : Promise.resolve(),
    ]);
    return true;
};

module.exports.constants = {
    RIDE_PASSENGER_ORIGINS,
    RIDE_FORCE_ORIGINS,
    RIDE_CAPTAIN_PRESENTIAL_ORIGINS,
    PARCEL_PASSENGER_ORIGINS,
    PARCEL_FORCE_ORIGINS,
};
