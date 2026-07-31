const mapService = require('../services/maps.service');
const { validationResult } = require('express-validator');


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