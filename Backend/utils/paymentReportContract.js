const PAYMENT_REPORTED_EVENT = 'payment-reported';
const REPORTABLE_PAYMENT_METHODS = ['cash', 'pix'];

function domainError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function evaluatePaymentReport(ride) {
    if (ride.status !== 'finished') {
        throw domainError('RIDE_NOT_FINISHED', 'Ride not finished yet');
    }

    if (ride.paymentStatus === 'paid') {
        return { reportStatus: 'already_confirmed', shouldNotify: false };
    }

    if (!REPORTABLE_PAYMENT_METHODS.includes(ride.paymentMethod)) {
        throw domainError(
            'PAYMENT_REPORT_NOT_ALLOWED',
            'Passenger payment reports are only allowed for cash or pix'
        );
    }

    if (ride.paymentStatus !== 'pending') {
        throw domainError('PAYMENT_NOT_PENDING', 'Payment is not pending');
    }

    if (ride.paymentReportedAt) {
        return { reportStatus: 'already_reported', shouldNotify: false };
    }

    return { reportStatus: 'reported', shouldNotify: true };
}

function buildCaptainPaymentReportPayload(ride) {
    return {
        rideId: ride._id.toString(),
        status: ride.status,
        paymentStatus: ride.paymentStatus,
        paymentMethod: ride.paymentMethod,
        amount: Number(ride.finalPrice ?? ride.fare ?? 0),
        reportedAt: ride.paymentReportedAt,
    };
}

function buildPassengerPaymentReportResponse(ride, reportStatus) {
    return {
        rideId: ride._id.toString(),
        reportStatus,
        paymentStatus: ride.paymentStatus,
        message: reportStatus === 'already_confirmed'
            ? 'Pagamento já confirmado pelo motorista.'
            : 'Informação enviada. O motorista ainda precisa confirmar o recebimento.',
    };
}

module.exports = {
    PAYMENT_REPORTED_EVENT,
    REPORTABLE_PAYMENT_METHODS,
    evaluatePaymentReport,
    buildCaptainPaymentReportPayload,
    buildPassengerPaymentReportResponse,
};
