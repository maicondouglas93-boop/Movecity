const mapService = require('../services/maps.service');
const { validationResult } = require('express-validator');
const { deriveLegacyAuthorization } = require('../services/vehicleAuthorization.service');
const {
    PUBLIC_DRIVER_MAP_RADIUS_KM,
    createPublicMapSubscription,
    toPublicDriver,
} = require('../utils/publicDriverMap');


module.exports.getCoordinates = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }


    const { address } = req.query;

    try {
        const coordinates = await mapService.getAddressCoordinate(address);
        res.status(200).json(coordinates);
    } catch (error) {
        res.status(404).json({ message: 'Coordinates not found' });
    }
}

module.exports.getDistanceTime = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { origin, destination } = req.query;

        const distanceTime = await mapService.getDistanceTime(origin, destination);

        res.status(200).json(distanceTime);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

// Fase D da experiência de corrida ativa (2026-08-03): rota com manobras para a
// navegação do motorista. Existe separado de /get-distance-time (que serve à
// precificação e não pode ganhar o custo extra do detalhamento de passos) e existe no
// backend, e não no frontend, porque até aqui o LiveTracking chamava o OSRM público
// direto do navegador — sem chave, sem cache, sem controle de custo e quebrando a
// regra de o backend ser a única fonte da verdade.
module.exports.getRoute = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { origin, destination } = req.query;
        const route = await mapService.getRouteWithSteps(origin, destination);
        return res.status(200).json(route);
    } catch (err) {
        console.error('[maps] getRoute falhou:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports.getAutoCompleteSuggestions = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { input, lat, lng, sessionToken } = req.query;

        // Body da resposta continua sendo o array puro de sempre (contrato preservado,
        // verificado byte-a-byte na Etapa 2). O sessionToken (só existe quando o
        // provider é "google") vai num header à parte, opcional — clientes antigos
        // que não leem esse header não são afetados.
        const { suggestions, sessionToken: newSessionToken } = await mapService.getAutoCompleteSuggestionsWithSession(input, lat, lng, sessionToken);

        if (newSessionToken) {
            res.set('X-Maps-Session-Token', newSessionToken);
        }

        res.status(200).json(suggestions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports.getPlaceDetails = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { placeId, sessionToken } = req.query;

        const details = await mapService.getPlaceDetails(placeId, sessionToken);

        res.status(200).json(details);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

// Fase C da experiência de corrida ativa (2026-08-03): snapshot inicial dos motoristas
// disponíveis pro mapa do passageiro. O tempo real fica por conta dos eventos
// driver-location/driver-busy/driver-offline (socket.js); este endpoint reconstrói o
// estado completo na abertura, no reconnect e na volta do background — a mesma filosofia
// do RideContext: REST reconstrói, socket só atualiza.
// Retorna identidade efêmera e posição aproximada. A assinatura curta enviada no
// header vincula o Socket.IO ao mesmo centro/raio deste snapshot.
module.exports.getNearbyDrivers = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { lat, lng } = req.query;

    try {
        const rideModel = require('../models/ride.model');
        const parcelModel = require('../models/parcel.model');
        const dispatchService = require('../services/dispatch.service');
        const center = { lat: parseFloat(lat), lng: parseFloat(lng) };
        const subscription = createPublicMapSubscription({
            userId: req.user._id,
            center,
        });
        // Mesmo raio e mesmos critérios de disponibilidade do despacho.
        const captains = await mapService.getCaptainsInTheRadius(
            center.lat,
            center.lng,
            PUBLIC_DRIVER_MAP_RADIUS_KM
        );

        // Disponível ≠ ocupado: corrida e encomenda usam a mesma exclusão mútua do
        // despacho. O snapshot anterior verificava só corridas e podia mostrar como
        // livre um motorista que estava fazendo entrega.
        const captainIds = captains.map((captain) => captain._id);
        const [activeRides, activeParcels] = await Promise.all([
            rideModel.find({
                captain: { $in: captainIds },
                status: { $in: dispatchService.ACTIVE_RIDE_STATUSES },
            }).select('captain'),
            parcelModel.find({
                captain: { $in: captainIds },
                status: { $in: dispatchService.ACTIVE_PARCEL_STATUSES },
            }).select('captain'),
        ]);
        const busyIds = new Set(
            [...activeRides, ...activeParcels].map((work) => work.captain.toString())
        );

        const drivers = captains
            .filter((captain) => !captain.busyLock && !busyIds.has(captain._id.toString()))
            .map((captain) => toPublicDriver({
                _id: captain._id,
                vehicle: captain.vehicle,
                vehicleAuthorization: deriveLegacyAuthorization(captain),
                location: captain.location,
            }, subscription.nonce))
            .filter(Boolean);

        res.setHeader('X-Driver-Map-Subscription', subscription.token);
        res.setHeader('X-Driver-Map-Expires-At', new Date(subscription.expiresAt).toISOString());
        res.setHeader('Cache-Control', 'private, no-store');

        return res.status(200).json(drivers);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports.getReverseGeocode = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { lat, lng } = req.query;

        const result = await mapService.getReverseGeocode(parseFloat(lat), parseFloat(lng));

        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}
