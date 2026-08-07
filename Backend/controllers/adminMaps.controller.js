const mapService = require('../services/maps.service');
const { validationResult } = require('express-validator');

/** Autocomplete de endereço para o painel admin (mesmo maps.service do app). */
module.exports.getSuggestions = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { input, lat, lng, sessionToken } = req.query;
        const { suggestions, sessionToken: newSessionToken } =
            await mapService.getAutoCompleteSuggestionsWithSession(input, lat, lng, sessionToken);

        if (newSessionToken) {
            res.set('X-Maps-Session-Token', newSessionToken);
        }

        return res.status(200).json(suggestions);
    } catch (err) {
        console.error('[admin/maps] getSuggestions:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports.getPlaceDetails = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { placeId, sessionToken } = req.query;
        const details = await mapService.getPlaceDetails(placeId, sessionToken);
        return res.status(200).json(details);
    } catch (err) {
        console.error('[admin/maps] getPlaceDetails:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Distância/tempo/polyline reais entre partida e destino para o simulador de tarifas.
 * Body: { pickup, destination }
 */
module.exports.estimateRoute = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { pickup, destination } = req.body;
        const route = await mapService.getDistanceTime(pickup, destination);

        const distanceMeters = Number(route?.distance?.value) || 0;
        const durationSeconds = Number(route?.duration?.value) || 0;

        return res.status(200).json({
            distanceMeters,
            durationSeconds,
            distanceKm: Math.round((distanceMeters / 1000) * 100) / 100,
            durationMin: Math.max(1, Math.round(durationSeconds / 60)),
            polyline: Array.isArray(route?.polyline) ? route.polyline : [],
            distanceText: route?.distance?.text || null,
            durationText: route?.duration?.text || null,
        });
    } catch (err) {
        console.error('[admin/maps] estimateRoute:', err.message);
        return res.status(500).json({ message: err.message || 'Falha ao calcular rota' });
    }
};
