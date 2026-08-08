const tariffSettingModel = require('../models/tariffSetting.model');
const { getCache, setCache, deleteCache } = require('../cache/cache');

// Auditoria de cache (2026-08-08, A4): TariffSetting é singleton, lido em
// resolveTariffSetting (fallback pra corridas antigas sem pricingSnapshot) e em
// getFare (só pra ler o boolean showAsEstimate — busca o doc inteiro pra isso).
// Muda só quando um admin salva "Tarifas Globais" ou quando um agendamento de
// tarifa é aplicado pelo cron (tariffScheduler.service.js). TTL 600s, mesmo padrão
// de VehicleCategory pra dado administrativo estático.
const TTL_SECONDS = 600;
const CACHE_KEY = 'tariff-setting:singleton';

module.exports.getCachedTariffSetting = async () => {
    const cached = getCache(CACHE_KEY);
    if (cached) return cached;

    const tariffSetting = await tariffSettingModel.findOne();
    if (tariffSetting) setCache(CACHE_KEY, tariffSetting, TTL_SECONDS);
    return tariffSetting;
};

// Chamar em todo write de TariffSetting (admin.service.js: updateGlobalSettings;
// tariffScheduler.service.js: aplicação de agendamento).
module.exports.invalidateTariffSettingCache = () => {
    deleteCache(CACHE_KEY);
};
