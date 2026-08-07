const vehicleCategoryModel = require('../models/vehicleCategory.model');

// Catálogo público de categorias ativas — consumido pelo app do passageiro (lista de
// veículos) e pelo cadastro do motorista (seleção do tipo de veículo). Não expõe as
// tarifas (baseFare/perKmRate/etc) pois quem calcula preço é sempre o backend.
module.exports.getActiveCategories = async (req, res) => {
    try {
        const service = req.query.service;
        const fieldByService = { ride: 'allowedServices.ride', parcel: 'allowedServices.parcel', scheduledRide: 'allowedServices.scheduledRide', scheduledParcel: 'allowedServices.scheduledParcel' };
        const query = { isActive: true };
        if (fieldByService[service]) query[fieldByService[service]] = { $ne: false };
        const categories = await vehicleCategoryModel
            .find(query)
            .select('name displayName description capacity iconKey sortOrder allowedServices')
            .sort({ sortOrder: 1, displayName: 1 });

        res.status(200).json(categories);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
