const defaultRideModel = require('../models/ride.model');
const {
    REPORTABLE_PAYMENT_METHODS,
    evaluatePaymentReport,
} = require('../utils/paymentReportContract');

function withCaptain(query) {
    return query.populate('captain', '_id socketId');
}

function createPaymentReportService({ rideModel = defaultRideModel, now = () => new Date() } = {}) {
    async function loadOwnedRide(rideId, userId) {
        return withCaptain(rideModel.findOne({ _id: rideId, user: userId }));
    }

    async function reportPayment({ rideId, user }) {
        if (!rideId) {
            const error = new Error('Ride id is required');
            error.code = 'RIDE_ID_REQUIRED';
            throw error;
        }
        if (!user?._id) {
            const error = new Error('User is required');
            error.code = 'USER_REQUIRED';
            throw error;
        }

        const existing = await loadOwnedRide(rideId, user._id);
        if (!existing) {
            const error = new Error('Ride not found');
            error.code = 'RIDE_NOT_FOUND';
            throw error;
        }

        const initial = evaluatePaymentReport(existing);
        if (!initial.shouldNotify) {
            return { ride: existing, ...initial };
        }

        const reportedAt = now();
        const claimed = await withCaptain(rideModel.findOneAndUpdate(
            {
                _id: rideId,
                user: user._id,
                status: 'finished',
                paymentStatus: 'pending',
                paymentMethod: { $in: REPORTABLE_PAYMENT_METHODS },
                paymentReportedAt: null,
            },
            { $set: { paymentReportedAt: reportedAt } },
            { new: true }
        ));

        if (claimed) {
            return {
                ride: claimed,
                reportStatus: 'reported',
                shouldNotify: true,
            };
        }

        // Outro retry pode ter vencido a guarda atômica. Releitura transforma essa
        // corrida em sucesso idempotente, sem socket ou push duplicado.
        const latest = await loadOwnedRide(rideId, user._id);
        if (!latest) {
            const error = new Error('Ride not found');
            error.code = 'RIDE_NOT_FOUND';
            throw error;
        }
        const concurrent = evaluatePaymentReport(latest);
        if (!concurrent.shouldNotify) {
            return { ride: latest, ...concurrent };
        }

        const error = new Error('Payment report could not be claimed');
        error.code = 'PAYMENT_REPORT_CONFLICT';
        throw error;
    }

    return { reportPayment };
}

const paymentReportService = createPaymentReportService();

module.exports = {
    ...paymentReportService,
    createPaymentReportService,
};
