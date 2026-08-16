const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
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
} = require('../../utils/actorDtos');

const secretUser = {
    _id: 'user-1',
    fullname: { firstname: 'Maria', lastname: 'Silva' },
    profilePicture: 'https://img.example/user.jpg',
    rating: 4.9,
    phone: '+5533999999999',
    email: 'maria@example.com',
    cpf: '12345678901',
    password: 'hash-secreto',
    socketId: 'socket-user-secreto',
    walletBalance: 999,
    isBlocked: false,
    observations: [{ text: 'nota interna do admin' }],
    tags: ['vip'],
};

const secretCaptain = {
    _id: 'captain-1',
    fullname: { firstname: 'João', lastname: 'Souza' },
    profilePicture: 'https://img.example/captain.jpg',
    rating: 4.8,
    phone: '+5533888888888',
    email: 'joao@example.com',
    cpf: '10987654321',
    password: 'hash-secreto',
    socketId: 'socket-captain-secreto',
    documents: { cnhFront: { url: 'https://private.example/cnh.jpg' } },
    pix: { keyType: 'cpf', key: '10987654321' },
    bankDetails: { bankName: 'Banco', bankAccount: '12345-6' },
    earnings: 5000,
    approvalStatus: 'aprovado',
    isBlocked: false,
    vehicleAuthorization: 'car',
    vehicle: {
        marca: 'Toyota',
        modelo: 'Corolla',
        ano: 2024,
        color: 'Prata',
        plate: 'ABC1D23',
        capacity: 4,
        vehicleType: 'car',
    },
    location: { ltd: -20.1, lng: -41.6 },
    locationGeoJSON: { type: 'Point', coordinates: [-41.6, -20.1] },
    lastSeenAt: '2026-08-15T12:00:00.000Z',
};

const secretRide = {
    _id: 'ride-1',
    user: secretUser,
    captain: secretCaptain,
    source: 'passenger_requested',
    createdBy: { _id: 'admin-secret', name: 'Admin Interno', password: 'hash-admin' },
    createdByRole: 'admin',
    idempotencyKey: 'idempotency-secret',
    adminPassenger: { name: 'Pessoa interna', phone: '+5533000000000', note: 'interno' },
    pickup: 'Rua A, 10',
    destination: 'Rua B, 20',
    pickupCoordinates: { lat: -20.1, lng: -41.6 },
    destinationCoordinates: { lat: -20.2, lng: -41.7 },
    fare: 25,
    finalPrice: 28,
    vehicleType: 'car',
    status: 'accepted',
    scheduledAt: null,
    estimatedDistance: 7000,
    estimatedTime: 900,
    actualDistance: 0,
    actualTime: 0,
    paymentMethod: 'pix',
    paymentStatus: 'pending',
    optionals: [],
    observation: 'Portão azul',
    requestFemaleDriver: false,
    otp: '4321',
    createdAt: '2026-08-15T11:00:00.000Z',
    updatedAt: '2026-08-15T11:05:00.000Z',
    offerExpiresAt: '2026-08-15T11:10:00.000Z',
    activatedAt: '2026-08-15T11:00:00.000Z',
    dispatchAttempts: 2,
    dispatchLastAttemptAt: '2026-08-15T11:01:00.000Z',
    promoCodeScheduled: 'SEGREDO',
    useWalletScheduled: true,
    scheduleFinanceSettledAt: '2026-08-15T11:01:00.000Z',
    origin: { coordinates: [-41.6, -20.1] },
    destinationMeta: { source: 'gps_at_finish' },
    lastLocation: { lat: -20.1, lng: -41.6 },
    lastLocationAt: '2026-08-15T11:04:00.000Z',
    finalizationState: 'retry_required',
    finalizationStartedAt: '2026-08-15T11:04:30.000Z',
    promotionApplied: 'promotion-secret',
    commissionAmount: 5,
    commissionPercent: 20,
    fareBreakdown: { base: 10, platformCommission: 5 },
    pricingSnapshot: { secretRule: true },
    paymentID: 'fake-payment-id',
    gatewayTransactionId: 'gateway-secret',
    orderId: 'order-secret',
    signature: 'signature-secret',
    walletAmountDebited: 10,
    walletAmountUsed: 10,
    walletSettlementStatus: 'shortfall',
    walletShortfallAmount: 3,
    dispatchLeaseUntil: '2026-08-15T11:02:00.000Z',
    dispatchLastError: 'internal error',
    finalizationError: 'internal error',
    processedTrackingPointIds: ['gps-secret'],
    captainCancellations: [{ captain: 'captain-2' }],
    adminFinalization: { adminName: 'Admin', observation: 'nota interna' },
    paymentGateway: 'asaas',
};

const secretParcel = {
    _id: 'parcel-1',
    user: secretUser,
    captain: secretCaptain,
    vehicleType: 'car',
    pickup: 'Rua A, 10',
    destination: 'Rua B, 20',
    pickupCoordinates: { lat: -20.1, lng: -41.6 },
    destinationCoordinates: { lat: -20.2, lng: -41.7 },
    sender: { name: 'Maria', phone: '+5533999999999' },
    recipient: { name: 'Carlos', phone: '+5533777777777' },
    itemName: 'Documento',
    category: 'documento',
    weightKg: 1,
    size: 'small',
    description: 'Envelope',
    notes: 'Entregar em mãos',
    schedule: { mode: 'now', at: null },
    scheduledAt: null,
    fare: 18,
    estimatedDistance: 5000,
    estimatedTime: 700,
    deliveryPin: '9876',
    status: 'provider_accepted',
    statusHistory: [{ status: 'provider_accepted', by: 'captain' }],
    photos: { pickupUrl: null, deliveryUrl: null },
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    createdAt: '2026-08-15T11:00:00.000Z',
    updatedAt: '2026-08-15T11:05:00.000Z',
    offerExpiresAt: '2026-08-15T11:10:00.000Z',
    commissionAmount: 3,
    commissionPercent: 16.7,
    fareBreakdown: { platformCommission: 3 },
    pricingSnapshot: { secretRule: true },
    dispatchLeaseUntil: '2026-08-15T11:02:00.000Z',
    dispatchLastError: 'internal error',
};

const FORBIDDEN_PUBLIC_KEYS = new Set([
    'password', 'email', 'cpf', 'socketId', 'walletBalance', 'documents', 'pix',
    'bankDetails', 'earnings', 'approvalStatus', 'isBlocked', 'observations', 'tags',
    'locationGeoJSON', 'commissionAmount', 'commissionPercent', 'fareBreakdown',
    'pricingSnapshot', 'paymentID', 'gatewayTransactionId', 'orderId', 'signature',
    'walletAmountDebited', 'dispatchLeaseUntil', 'dispatchLastError',
    'finalizationError', 'processedTrackingPointIds', 'captainCancellations',
    'adminFinalization', 'createdBy', 'createdByRole', 'idempotencyKey',
    'activatedAt', 'dispatchAttempts', 'dispatchLastAttemptAt',
    'promoCodeScheduled', 'useWalletScheduled', 'scheduleFinanceSettledAt',
    'origin', 'destinationMeta', 'lastLocation', 'lastLocationAt',
    'finalizationState', 'finalizationStartedAt', 'promotionApplied',
    'walletAmountUsed', 'walletSettlementStatus', 'walletShortfallAmount',
    'adminPassenger', 'paymentGateway',
]);

function collectForbiddenPaths(value, forbidden = FORBIDDEN_PUBLIC_KEYS, prefix = '') {
    if (!value || typeof value !== 'object') return [];
    const paths = [];
    for (const [key, child] of Object.entries(value)) {
        const current = prefix ? `${prefix}.${key}` : key;
        if (forbidden.has(key)) paths.push(current);
        paths.push(...collectForbiddenPaths(child, forbidden, current));
    }
    return paths;
}

function assertNoForbiddenFields(payload, label) {
    assert.deepEqual(collectForbiddenPaths(payload), [], `${label} contém campo proibido`);
}

test('oferta de corrida revela somente primeiro nome e campos operacionais allowlist', () => {
    const dto = toRideOfferDTO({ ...secretRide, status: 'requested' });

    assert.deepEqual(dto.user, { fullname: { firstname: 'Maria' } });
    assert.deepEqual(Object.keys(dto).sort(), [
        '_id', 'createdAt', 'destination', 'destinationCoordinates', 'driverAmount',
        'estimatedDistance', 'estimatedTime', 'fare', 'observation', 'offerExpiresAt',
        'optionals', 'paymentMethod', 'pickup', 'pickupCoordinates',
        'requestFemaleDriver', 'scheduledAt', 'source', 'status', 'user', 'vehicleType',
    ].sort());
    assertNoForbiddenFields(dto, 'oferta de corrida');
});

test('corrida aceita separa identidade do passageiro e do motorista por ator', () => {
    const captainView = toRideCaptainDTO(secretRide);
    const passengerView = toRidePassengerDTO(secretRide);

    assert.deepEqual(Object.keys(captainView.user).sort(), [
        '_id', 'fullname', 'phone', 'profilePicture', 'rating',
    ].sort());
    assert.equal(captainView.otp, undefined);
    assert.deepEqual(Object.keys(passengerView.captain).sort(), [
        '_id', 'fullname', 'lastSeenAt', 'location', 'phone', 'profilePicture',
        'rating', 'vehicle', 'vehicleAuthorization',
    ].sort());
    assert.equal(passengerView.otp, '4321');
    assertNoForbiddenFields(captainView, 'corrida para motorista');
    assertNoForbiddenFields(passengerView, 'corrida para passageiro');
});

test('históricos removem dados de contato e localização que já não são necessários', () => {
    const captainHistory = toRideCaptainHistoryDTO(secretRide);
    const passengerHistory = toRidePassengerHistoryDTO(secretRide);

    assert.equal(captainHistory.user.phone, undefined);
    assert.equal(passengerHistory.captain.phone, undefined);
    assert.equal(passengerHistory.captain.location, undefined);
    assert.equal(passengerHistory.otp, undefined);
    assertNoForbiddenFields(captainHistory, 'histórico do motorista');
    assertNoForbiddenFields(passengerHistory, 'histórico do passageiro');
});

test('encomenda pré-aceite não revela remetente, destinatário, PIN ou identidade', () => {
    const dto = toParcelOfferDTO({ ...secretParcel, status: 'awaiting_provider' });

    assert.equal(dto.sender, undefined);
    assert.equal(dto.recipient, undefined);
    assert.equal(dto.deliveryPin, undefined);
    assert.equal(dto.user, undefined);
    assert.equal(dto.captain, undefined);
    assert.deepEqual(Object.keys(dto).sort(), [
        '_id', 'category', 'createdAt', 'description', 'destination',
        'destinationCoordinates', 'driverAmount', 'estimatedDistance', 'estimatedTime',
        'fare', 'itemName', 'notes', 'offerExpiresAt', 'paymentMethod', 'pickup',
        'pickupCoordinates', 'size', 'status', 'vehicleType', 'weightKg',
    ].sort());
    assertNoForbiddenFields(dto, 'oferta de encomenda');
});

test('encomenda aceita entrega contatos só ao motorista vinculado e PIN só ao passageiro', () => {
    const captainView = toParcelCaptainDTO(secretParcel, { requireDeliveryPin: true });
    const passengerView = toParcelPassengerDTO(secretParcel, { requireDeliveryPin: true });

    assert.deepEqual(captainView.sender, secretParcel.sender);
    assert.deepEqual(captainView.recipient, secretParcel.recipient);
    assert.equal(captainView.deliveryPin, undefined);
    assert.deepEqual(Object.keys(captainView.user).sort(), [
        '_id', 'fullname', 'phone', 'profilePicture', 'rating',
    ].sort());
    assert.equal(passengerView.deliveryPin, '9876');
    assert.equal(passengerView.captain.socketId, undefined);
    assertNoForbiddenFields(captainView, 'encomenda para motorista');
    assertNoForbiddenFields(passengerView, 'encomenda para passageiro');
});

test('históricos de encomenda retiram telefones do ator oposto', () => {
    const captainHistory = toParcelCaptainHistoryDTO(secretParcel);
    const passengerHistory = toParcelPassengerHistoryDTO(secretParcel);

    assert.deepEqual(captainHistory.sender, { name: 'Maria' });
    assert.deepEqual(captainHistory.recipient, { name: 'Carlos' });
    assert.equal(captainHistory.user.phone, undefined);
    assert.equal(passengerHistory.captain.phone, undefined);
    assert.equal(passengerHistory.captain.location, undefined);
    assertNoForbiddenFields(captainHistory, 'histórico de encomenda do motorista');
    assertNoForbiddenFields(passengerHistory, 'histórico de encomenda do passageiro');
});

test('DTOs administrativos também usam identidade allowlist sem documentos bancários', () => {
    const ride = toAdminRideDTO(secretRide);
    const parcel = toAdminParcelDTO(secretParcel);
    const rideWithIds = toAdminRideDTO({
        ...secretRide,
        user: 'user-id',
        captain: 'captain-id',
        createdBy: 'admin-id',
    });

    assert.equal(ride.user.email, secretUser.email);
    assert.equal(ride.captain.email, secretCaptain.email);
    assert.equal(parcel.user.phone, secretUser.phone);
    assert.equal(ride.captain.documents, undefined);
    assert.equal(ride.captain.pix, undefined);
    assert.equal(ride.captain.bankDetails, undefined);
    assert.equal(ride.user.password, undefined);
    assert.deepEqual(rideWithIds.user, { _id: 'user-id' });
    assert.deepEqual(rideWithIds.captain, { _id: 'captain-id' });
    assert.deepEqual(rideWithIds.createdBy, { _id: 'admin-id' });
});

test('controllers públicos não voltam a emitir ou responder documentos crus', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    const rideController = fs.readFileSync(path.join(backendRoot, 'controllers/ride.controller.js'), 'utf8');
    const parcelController = fs.readFileSync(path.join(backendRoot, 'controllers/parcel.controller.js'), 'utf8');
    const adminController = fs.readFileSync(path.join(backendRoot, 'controllers/admin.controller.js'), 'utf8');
    const adminService = fs.readFileSync(path.join(backendRoot, 'services/admin.service.js'), 'utf8');
    const parcelService = fs.readFileSync(path.join(backendRoot, 'services/parcel.service.js'), 'utf8');

    assert.doesNotMatch(rideController, /data:\s*ride\s*[,}]/);
    assert.doesNotMatch(parcelController, /data:\s*parcel\s*[,}]/);
    assert.doesNotMatch(rideController, /\.json\(ride\)/);
    assert.doesNotMatch(parcelController, /\.json\(parcel\)/);
    assert.doesNotMatch(rideController, /\.\.\.ride\.toObject\(\)/);
    assert.doesNotMatch(parcelController, /\.\.\.parcel\.toObject\(\)/);
    assert.doesNotMatch(adminController, /\.json\(ride\)/);
    assert.doesNotMatch(adminController, /\.json\(parcel\)/);
    assert.match(adminController, /\.json\(toAdminRideDTO\(ride\)\)/);
    assert.match(adminController, /\.json\(toAdminParcelDTO\(parcel\)\)/);
    assert.match(adminService, /rides\.map\(\(ride\) => toAdminRideDTO\(ride\)\)/);
    assert.match(parcelService, /items: items\.map\(\(parcel\) => toAdminParcelDTO\(parcel\)\)/);
});
