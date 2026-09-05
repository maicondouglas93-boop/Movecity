// Distância e âncora precisam vir da MESMA leitura/atualização do documento.
module.exports = function rideTrackingCheckpoint(ride) {
    if (!ride) return undefined;
    return {
        actualDistance: Math.max(0, Number(ride.actualDistance) || 0),
        lastLocation: ride.lastLocation?.lat != null && ride.lastLocation?.lng != null
            ? { lat: ride.lastLocation.lat, lng: ride.lastLocation.lng } : null,
        lastLocationAt: ride.lastLocationAt || null,
    };
};
