const vehicleCategoryModel = require('../models/vehicleCategory.model');

// Catálogo público de categorias ativas — consumido pelo app do passageiro (lista de
// veículos) e pelo cadastro do motorista (seleção do tipo de veículo). Não expõe as
// tarifas (baseFare/perKmRate/etc) pois quem calcula preço é sempre o backend.
module.exports.getActiveCategories = async (req, res) => {
    try {
        const categories = await vehicleCategoryModel
            .find({ isActive: true })
            .select('name displayName description capacity iconKey sortOrder')
            .sort({ sortOrder: 1, displayName: 1 });

        res.status(200).json(categories);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
