const globalSettingModel = require('../models/globalSetting.model');
const { getCache, setCache, deleteCache } = require('../cache/cache');

// Auditoria de cache (2026-08-08, A5): GlobalSetting é lido em buildConfigSnapshot
// (cardFeePercent/cardFeeFixed, uma vez por categoria calculada em getFare) e dentro
// de wallet.service.js (createTransaction — até 3x numa única confirmação de
// pagamento; requestPayout) — sempre o mesmo documento singleton, que só muda quando
// um admin salva "Tarifas Globais".
//
// TTL propositalmente mais curto (120s) que VehicleCategory/TariffSetting (600s):
// este documento também gateia blockDriverOnNegativeBalance/maximumNegativeBalance
// dentro do caminho de pagamento — uma janela menor limita quanto tempo uma mudança
// de regra pelo admin demora pra valer numa transação de carteira.
const TTL_SECONDS = 120;
const CACHE_KEY = 'global-setting:singleton';

module.exports.getCachedGlobalSetting = async () => {
    const cached = getCache(CACHE_KEY);
    if (cached) return cached;

    const globalSetting = await globalSettingModel.findOne();
    if (globalSetting) setCache(CACHE_KEY, globalSetting, TTL_SECONDS);
    return globalSetting;
};

// Chamar em todo write de GlobalSetting (admin.service.js: updateGlobalSettings).
module.exports.invalidateGlobalSettingCache = () => {
    deleteCache(CACHE_KEY);
};
