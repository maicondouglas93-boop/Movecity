const vehicleCategoryModel = require('../models/vehicleCategory.model');
const { getCache, setCache, deleteByPrefix } = require('../cache/cache');

// Auditoria de cache (2026-08-08, A3): VehicleCategory é lido 3+ vezes por corrida
// criada (isVehicleCategoryAllowed no create, buildConfigSnapshot no cálculo de
// tarifa, de novo em filterCaptainsByServicePermission no despacho) e 1+N vezes em
// getFare (N = categorias ativas) — sempre o(s) mesmo(s) documento(s), que só muda(m)
// quando um admin salva uma categoria/tarifa. TTL 600s (10min), mesmo padrão já usado
// nesta base pra dado administrativo estático (profile:captain/user).
//
// Cacheia o documento Mongoose INTEIRO (não .lean()) de propósito: alguns call sites
// (ex.: pricingEngine.calculateCancellationFee) chamam .toObject() no resultado — um
// objeto já "lean" não tem esse método. Guardar o doc completo preserva o contrato de
// cada chamador sem precisar tocar em cada um deles.
const TTL_SECONDS = 600;
const BY_NAME_PREFIX = 'vehicle-category:';
const ACTIVE_LIST_KEY = 'vehicle-category-list:active';

// Sem filtro de isActive na query de propósito — dispatch.service.js precisa
// distinguir "não existe" de "existe mas está inativa" (respostas diferentes), o que
// só dá pra fazer buscando por nome e checando isActive depois. Quem só quer
// categoria ATIVA (pricingEngine) checa `category?.isActive` no próprio call site,
// exatamente como fazia antes via filtro na query — mesmo resultado observável.
module.exports.getCachedVehicleCategoryByName = async (name) => {
    const cacheKey = `${BY_NAME_PREFIX}${name}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const category = await vehicleCategoryModel.findOne({ name });
    if (category) setCache(cacheKey, category, TTL_SECONDS);
    return category;
};

module.exports.getCachedActiveVehicleCategories = async () => {
    const cached = getCache(ACTIVE_LIST_KEY);
    if (cached) return cached;

    const categories = await vehicleCategoryModel.find({ isActive: true });
    setCache(ACTIVE_LIST_KEY, categories, TTL_SECONDS);
    return categories;
};

// Chamar em todo write de VehicleCategory (admin.service.js: create/update;
// admin.controller.js: duplicateCategory; tariffScheduler.service.js: aplicação de
// agendamento) — 'vehicle-category' é prefixo comum de BY_NAME_PREFIX e
// ACTIVE_LIST_KEY, então uma chamada limpa os dois.
module.exports.invalidateVehicleCategoryCache = () => {
    deleteByPrefix('vehicle-category');
};
