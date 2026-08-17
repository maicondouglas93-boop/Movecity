const { computeDriverAmount, toPlain, toPassengerFareRates } = require('./financePrivacy');
const { computeOfferExpiresAt } = require('../config/offerPolicy');

function pickDefined(source, fields) {
    const output = {};
    for (const field of fields) {
        if (source?.[field] !== undefined) output[field] = source[field];
    }
    return output;
}

function plain(value) {
    if (value === null || value === undefined) return {};
    if (typeof value !== 'object') return value;
    return toPlain(value) || {};
}

function identityPlain(value) {
    const raw = plain(value);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    return { _id: raw };
}

function fullname(value, { firstNameOnly = false } = {}) {
    if (!value) return undefined;
    const name = { firstname: value.firstname || '' };
    if (!firstNameOnly && value.lastname !== undefined) name.lastname = value.lastname;
    return name;
}

function toUserIdentity(user, { includePhone = false, firstNameOnly = false } = {}) {
    if (!user) return undefined;
    const raw = identityPlain(user);
    if (firstNameOnly) {
        return { fullname: fullname(raw.fullname, { firstNameOnly: true }) };
    }

    return pickDefined({
        _id: raw._id,
        fullname: fullname(raw.fullname),
        profilePicture: raw.profilePicture,
        rating: raw.rating,
        phone: includePhone ? raw.phone : undefined,
    }, ['_id', 'fullname', 'profilePicture', 'rating', 'phone']);
}

function toCaptainIdentity(captain, {
    includePhone = false,
    includeLocation = false,
} = {}) {
    if (!captain) return undefined;
    const raw = identityPlain(captain);
    return pickDefined({
        _id: raw._id,
        fullname: fullname(raw.fullname),
        profilePicture: raw.profilePicture,
        rating: raw.rating,
        vehicle: raw.vehicle,
        vehicleAuthorization: raw.vehicleAuthorization,
        phone: includePhone ? raw.phone : undefined,
        location: includeLocation ? raw.location : undefined,
        lastSeenAt: includeLocation ? raw.lastSeenAt : undefined,
    }, [
        '_id', 'fullname', 'profilePicture', 'rating', 'vehicle',
        'vehicleAuthorization', 'phone', 'location', 'lastSeenAt',
    ]);
}

function toAdminUserIdentity(user) {
    if (!user) return undefined;
    const raw = identityPlain(user);
    return pickDefined({
        _id: raw._id,
        fullname: fullname(raw.fullname),
        profilePicture: raw.profilePicture,
        rating: raw.rating,
        email: raw.email,
        phone: raw.phone,
        city: raw.city,
    }, ['_id', 'fullname', 'profilePicture', 'rating', 'email', 'phone', 'city']);
}

function toAdminCaptainIdentity(captain) {
    if (!captain) return undefined;
    const raw = identityPlain(captain);
    return pickDefined({
        _id: raw._id,
        fullname: fullname(raw.fullname),
        profilePicture: raw.profilePicture,
        rating: raw.rating,
        email: raw.email,
        phone: raw.phone,
        vehicle: raw.vehicle,
        vehicleAuthorization: raw.vehicleAuthorization,
        approvalStatus: raw.approvalStatus,
        status: raw.status,
        isOnline: raw.isOnline,
        lastSeenAt: raw.lastSeenAt,
    }, [
        '_id', 'fullname', 'profilePicture', 'rating', 'email', 'phone', 'vehicle',
        'vehicleAuthorization', 'approvalStatus', 'status', 'isOnline', 'lastSeenAt',
    ]);
}

function toAdminCreatorIdentity(admin) {
    if (!admin) return undefined;
    const raw = identityPlain(admin);
    return pickDefined({
        _id: raw._id,
        name: raw.name,
        email: raw.email,
        role: raw.role,
    }, ['_id', 'name', 'email', 'role']);
}

const RIDE_COMMON_FIELDS = [
    '_id', 'source', 'destinationPending', 'pickup', 'destination',
    'pickupCoordinates', 'destinationCoordinates', 'fare', 'finalPrice',
    'vehicleType', 'status', 'scheduledAt', 'acceptedAt', 'startedAt', 'finishedAt',
    'arrivedAt', 'estimatedDistance', 'estimatedTime', 'estimatedPriceMin',
    'estimatedPriceMax', 'actualDistance', 'actualTime', 'paymentMethod',
    'paymentStatus', 'optionals', 'observation', 'requestFemaleDriver',
    'cancelledBy', 'cancellationReason',
    'cancelledAt', 'cancellationFeeCharged', 'waitTimeSeconds', 'createdAt',
    'updatedAt', 'liveFare',
];

const RIDE_OFFER_FIELDS = [
    '_id', 'source', 'pickup', 'destination', 'pickupCoordinates',
    'destinationCoordinates', 'fare', 'vehicleType', 'status', 'scheduledAt',
    'estimatedDistance', 'estimatedTime', 'paymentMethod', 'optionals',
    'observation', 'requestFemaleDriver', 'createdAt',
];

function rideBase(ride) {
    return pickDefined(plain(ride), RIDE_COMMON_FIELDS);
}

function toRideOfferDTO(ride) {
    if (!ride) return ride;
    const raw = plain(ride);
    const dto = pickDefined(raw, RIDE_OFFER_FIELDS);
    dto.driverAmount = computeDriverAmount(raw);
    const expiresAt = raw.offerExpiresAt || computeOfferExpiresAt(raw);
    if (expiresAt !== undefined) dto.offerExpiresAt = expiresAt;
    if (raw.user) dto.user = toUserIdentity(raw.user, { firstNameOnly: true });
    if (!dto.user && raw.source === 'admin' && raw.adminPassenger?.name) {
        dto.user = { fullname: { firstname: raw.adminPassenger.name } };
    }
    return dto;
}

function toRideCaptainDTO(ride, { includePresentialOtp = false } = {}) {
    if (!ride) return ride;
    const raw = plain(ride);
    const dto = rideBase(raw);
    dto.driverAmount = computeDriverAmount(raw);
    const fareRates = toPassengerFareRates(raw.pricingSnapshot);
    if (fareRates) dto.fareRates = fareRates;
    if (raw.user) dto.user = toUserIdentity(raw.user, { includePhone: true });
    if (!dto.user && raw.source === 'admin' && raw.adminPassenger?.name) {
        dto.user = {
            fullname: { firstname: raw.adminPassenger.name },
            ...(raw.adminPassenger.phone ? { phone: raw.adminPassenger.phone } : {}),
            isGuest: true,
        };
    }
    if (includePresentialOtp && raw.source === 'driver_initiated' && raw.otp !== undefined) {
        dto.otp = raw.otp;
    }
    return dto;
}

function toRidePassengerDTO(ride) {
    if (!ride) return ride;
    const raw = plain(ride);
    const dto = rideBase(raw);
    if (raw.captain) {
        dto.captain = toCaptainIdentity(raw.captain, {
            includePhone: true,
            includeLocation: true,
        });
    }
    if (raw.otp !== undefined) dto.otp = raw.otp;
    return dto;
}

function toRideCaptainHistoryDTO(ride) {
    if (!ride) return ride;
    const raw = plain(ride);
    const dto = rideBase(raw);
    dto.driverAmount = computeDriverAmount(raw);
    if (raw.user) dto.user = toUserIdentity(raw.user);
    return dto;
}

function toRidePassengerHistoryDTO(ride) {
    if (!ride) return ride;
    const raw = plain(ride);
    const dto = rideBase(raw);
    if (raw.captain) dto.captain = toCaptainIdentity(raw.captain);
    return dto;
}

const PARCEL_COMMON_FIELDS = [
    '_id', 'vehicleType', 'pickup', 'destination', 'pickupCoordinates',
    'destinationCoordinates', 'itemName', 'category', 'weightKg', 'size',
    'description', 'notes', 'schedule', 'scheduledAt', 'fare', 'estimatedDistance',
    'estimatedTime', 'status', 'statusHistory', 'photos', 'paymentMethod',
    'paymentStatus', 'cancelledBy', 'cancellationReason', 'cancelledAt',
    'createdAt', 'updatedAt',
];

const PARCEL_OFFER_FIELDS = [
    '_id', 'vehicleType', 'pickup', 'destination', 'pickupCoordinates',
    'destinationCoordinates', 'itemName', 'category', 'weightKg', 'size',
    'description', 'notes', 'fare', 'estimatedDistance', 'estimatedTime', 'status',
    'createdAt', 'paymentMethod',
];

function parcelBase(parcel) {
    return pickDefined(plain(parcel), PARCEL_COMMON_FIELDS);
}

function person(value, { includePhone = true } = {}) {
    if (!value) return undefined;
    return pickDefined({
        name: value.name,
        phone: includePhone ? value.phone : undefined,
    }, ['name', 'phone']);
}

function toParcelOfferDTO(parcel) {
    if (!parcel) return parcel;
    const raw = plain(parcel);
    const dto = pickDefined(raw, PARCEL_OFFER_FIELDS);
    dto.driverAmount = computeDriverAmount(raw);
    const expiresAt = raw.offerExpiresAt || computeOfferExpiresAt(raw);
    if (expiresAt !== undefined) dto.offerExpiresAt = expiresAt;
    return dto;
}

function toParcelCaptainDTO(parcel, { requireDeliveryPin } = {}) {
    if (!parcel) return parcel;
    const raw = plain(parcel);
    const dto = parcelBase(raw);
    dto.driverAmount = computeDriverAmount(raw);
    if (raw.user) dto.user = toUserIdentity(raw.user, { includePhone: true });
    if (raw.sender) dto.sender = person(raw.sender);
    if (raw.recipient) dto.recipient = person(raw.recipient);
    if (requireDeliveryPin !== undefined) dto.requireDeliveryPin = requireDeliveryPin;
    return dto;
}

function toParcelPassengerDTO(parcel, { requireDeliveryPin } = {}) {
    if (!parcel) return parcel;
    const raw = plain(parcel);
    const dto = parcelBase(raw);
    if (raw.sender) dto.sender = person(raw.sender);
    if (raw.recipient) dto.recipient = person(raw.recipient);
    if (raw.captain) {
        dto.captain = toCaptainIdentity(raw.captain, {
            includePhone: true,
            includeLocation: true,
        });
    }
    if (raw.deliveryPin !== undefined) dto.deliveryPin = raw.deliveryPin;
    if (requireDeliveryPin !== undefined) dto.requireDeliveryPin = requireDeliveryPin;
    return dto;
}

function toParcelCaptainHistoryDTO(parcel) {
    if (!parcel) return parcel;
    const raw = plain(parcel);
    const dto = parcelBase(raw);
    dto.driverAmount = computeDriverAmount(raw);
    if (raw.user) dto.user = toUserIdentity(raw.user);
    if (raw.sender) dto.sender = person(raw.sender, { includePhone: false });
    if (raw.recipient) dto.recipient = person(raw.recipient, { includePhone: false });
    return dto;
}

function toParcelPassengerHistoryDTO(parcel) {
    if (!parcel) return parcel;
    const raw = plain(parcel);
    const dto = parcelBase(raw);
    if (raw.sender) dto.sender = person(raw.sender);
    if (raw.recipient) dto.recipient = person(raw.recipient);
    if (raw.captain) dto.captain = toCaptainIdentity(raw.captain);
    return dto;
}

function toAdminRideDTO(ride, { includeOtp = false } = {}) {
    if (!ride) return ride;
    const raw = plain(ride);
    const dto = {
        ...rideBase(raw),
        ...pickDefined(raw, [
            'commissionAmount', 'commissionPercent', 'fareBreakdown', 'pricingSnapshot',
            'discountAmount', 'promotionApplied', 'statusHistory', 'adminPassenger',
            'adminFinalization', 'dispatchLastAttemptAt', 'walletSettlementStatus',
            'walletShortfallAmount', 'walletAmountUsed', 'walletAmountDebited',
            'waitTimeFeeCharged', 'finalizationState', 'finalizationStartedAt',
            'finalizationError',
        ]),
    };
    if (raw.user) dto.user = toAdminUserIdentity(raw.user);
    if (raw.captain) dto.captain = toAdminCaptainIdentity(raw.captain);
    if (raw.createdBy) dto.createdBy = toAdminCreatorIdentity(raw.createdBy);
    if (includeOtp && raw.otp !== undefined) dto.otp = raw.otp;
    return dto;
}

function toAdminParcelDTO(parcel) {
    if (!parcel) return parcel;
    const raw = plain(parcel);
    const dto = {
        ...parcelBase(raw),
        ...pickDefined(raw, [
            'commissionAmount', 'commissionPercent', 'fareBreakdown', 'pricingSnapshot',
        ]),
    };
    if (raw.sender) dto.sender = person(raw.sender);
    if (raw.recipient) dto.recipient = person(raw.recipient);
    if (raw.user) dto.user = toAdminUserIdentity(raw.user);
    if (raw.captain) dto.captain = toAdminCaptainIdentity(raw.captain);
    return dto;
}

module.exports = {
    toUserIdentity,
    toCaptainIdentity,
    toRideOfferDTO,
    toRideCaptainDTO,
    toRidePassengerDTO,
    toRideCaptainHistoryDTO,
    toRidePassengerHistoryDTO,
    toParcelOfferDTO,
    toParcelCaptainDTO,
    toParcelPassengerDTO,
    toParcelCaptainHistoryDTO,
    toParcelPassengerHistoryDTO,
    toAdminRideDTO,
    toAdminParcelDTO,
};
