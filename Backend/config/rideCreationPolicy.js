const PASSENGER_ACTIVE_RIDE_STATUSES = Object.freeze([
    'requested',
    'accepted',
    'going_to_pickup',
    'arrived',
    'waiting_passenger',
    'started',
]);

const RIDE_CREATION_INDEXES = Object.freeze({
    ACTIVE_PASSENGER: 'passenger_active_ride_unique',
    PASSENGER_IDEMPOTENCY: 'passenger_ride_idempotency_unique',
});

module.exports = {
    PASSENGER_ACTIVE_RIDE_STATUSES,
    RIDE_CREATION_INDEXES,
};
