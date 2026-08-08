const mongoose = require('mongoose');
const rideModel = require('../models/ride.model');
const userModel = require('../models/user.model');
const paymentModel = require('../models/payment.model');
const mapService = require('./maps.service');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const PricingEngine = require('./pricingEngine.service');
const { CAPTAIN_IDENTITY_FIELDS, USER_IDENTITY_FIELDS, toOfferPassengerPreview } = require('../utils/identityPopulate');
const { haversineKm } = require('./maps/geo.util');
const { computeOfferExpiresAt } = require('../config/offerPolicy');

// Máquina de estados da corrida (P2.1 da auditoria de concorrência, 2026-08-02) — toda
// transição de status passa por `transitionRide`, que faz um único `findOneAndUpdate`
// atômico com o(s) status de origem permitido(s) no próprio filtro. Antes, cada função
// (startRide, cancelRide, endRide, updateRideStatus...) validava o status em memória
// (`if (!['accepted', ...].includes(ride.status))`) e só DEPOIS gravava — entre a leitura
// e a escrita havia uma janela real de corrida (aceitar × cancelar, iniciar × cancelar
// simultâneos podiam produzir estados impossíveis, ver C3/C4 na auditoria). `finished` e
// `cancelled` são terminais: nenhuma chave abaixo os lista como origem de nada.
const VALID_ORIGINS_BY_TARGET = {
    accepted: ['requested'],
    going_to_pickup: ['accepted'],
    arrived: ['going_to_pickup', 'accepted'],
    // Fase A da experiência de corrida ativa (2026-08-03): 'waiting_passenger' sempre
    // esteve no enum do model e em UPDATE_STATUS_ALLOWED_TARGETS, mas faltava aqui —
    // qualquer tentativa de transição lançava "Transição de status desconhecida".
    waiting_passenger: ['arrived'],
    started: ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'],
    finished: ['started'],
    // SCH-M3 Fase 2: scheduled cancelável via /rides/cancel (mesmo motor de transição).
    cancelled: ['scheduled', 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'],
    // Única reversão da máquina (todo o resto é progressão linear ou término): motorista
    // desiste de uma corrida já aceita, mas antes de iniciar (auditoria de UX, 2026-08-02).
    // Não é um avanço nem um estado terminal — devolve a corrida ao pool de despacho pra
    // outro motorista aceitar, em vez de forçar o passageiro a pedir tudo de novo.
    requested: ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'],
};

// `extraFilter` permite exigir dono (captain/user) e outras condições (ex.: OTP) no
// mesmo `findOneAndUpdate` atômico — não só o status. `extraUnset` cobre o caso do
// motorista desistindo (acima): `captain` e `otp` precisam sair do documento, não só
// mudar de valor. Retorna `null` quando a transição não é válida a partir do estado
// atual (ou quando `extraFilter` não bate), e quem chama decide a mensagem/status HTTP.
async function transitionRide(rideId, toStatus, extraFilter = {}, extraSet = {}, extraUnset = {}, extraPush = {}) {
    const validOrigins = VALID_ORIGINS_BY_TARGET[toStatus];
    if (!validOrigins) {
        throw new Error(`Transição de status desconhecida: ${toStatus}`);
    }
    const update = { $set: { status: toStatus, ...extraSet } };
    if (Object.keys(extraUnset).length > 0) {
        update.$unset = extraUnset;
    }
    // Implementação do sistema de cancelamento (2026-08-04): cancelRideByCaptain usa
    // isto pra registrar, em captainCancellations, quem desistiu e por quê — sem sair
    // do padrão atômico (mesmo findOneAndUpdate, nenhuma escrita separada).
    if (Object.keys(extraPush).length > 0) {
        update.$push = extraPush;
    }
    return rideModel.findOneAndUpdate(
        { _id: rideId, status: { $in: validOrigins }, ...extraFilter },
        update,
        { new: true }
    );
}

// Preferir a tarifa congelada na corrida; só cai no live p/ corridas antigas
// sem pricingSnapshot (mesmo padrão do endRide).
async function resolveTariffSetting(ride) {
    const fromSnapshot = ride?.pricingSnapshot?.tariffSetting;
    if (fromSnapshot && typeof fromSnapshot === 'object') {
        return fromSnapshot.toObject?.() || fromSnapshot;
    }
    const TariffSetting = require('../models/tariffSetting.model');
    const live = await TariffSetting.findOne();
    return live ? (live.toObject?.() || live) : {};
}

/** Preços de adicionais a partir da categoria (fonte única — não TariffSetting). */
function resolveOptionalPricesFromCategory(category) {
    const optionals = category?.pricing?.optionals || [];
    const map = {};
    for (const opt of optionals) {
        if (!opt?.id) continue;
        if (opt.isActive === false) continue;
        map[opt.id] = Number(opt.value) || 0;
    }
    return map;
}

function sumRideOptionals(ride) {
    if (!Array.isArray(ride?.optionals)) return 0;
    return ride.optionals.reduce((s, o) => s + (Number(o.price) || 0), 0);
}

// ETA do motorista até o pickup: vizinho online mais próximo por categoria.
// Sem inventar minutos (antes: Math.random). Sem motorista → chave omitida.
async function estimateEtaByVehicleType(pickup, categoryNames) {
    const eta = {};
    try {
        const pickupCoord = await mapService.getAddressCoordinate(pickup);
        const captains = await mapService.getCaptainsInTheRadius(
            pickupCoord.ltd, pickupCoord.lng, 15, '[ETA]'
        );
        for (const name of categoryNames) {
            const nearest = captains.find(
                (c) => (c.vehicle?.vehicleType || c.vehicleType) === name
                    && c.location?.ltd != null && c.location?.lng != null
            );
            if (!nearest) continue;
            const km = haversineKm(
                nearest.location.ltd, nearest.location.lng,
                pickupCoord.ltd, pickupCoord.lng
            );
            if (!Number.isFinite(km)) continue;
            // ~25 km/h urbano médio; mínimo 1 min quando há motorista no raio.
            eta[name] = Math.max(1, Math.round((km / 25) * 60));
        }
    } catch (err) {
        console.warn('[getFare] ETA indisponível:', err.message);
    }
    return eta;
}

// Auditoria de integração (2026-08-06): esta cotação era cacheada inteira por 30
// minutos com a chave `fare:{pickup}:{destination}`, e nenhum caminho que altera
// tarifa invalidava essa chave — nem o painel admin, nem o cron de tarifa
// agendada. O passageiro via um preço e `createRide` (que sempre lê a config
// vigente) cobrava outro.
//
// O cache foi removido em vez de invalidado porque ele juntava duas coisas de
// volatilidade oposta: a ROTA, cara de obter e estável, e o PREÇO, barato de
// calcular e volátil. A rota continua cacheada uma camada abaixo, dentro dos
// providers (`google-route:` / `route:`), então tirar o cache daqui não gera
// nenhuma chamada extra à API de mapas — só recalcula a aritmética da tarifa
// com a configuração de agora.
async function getFare(pickup, destination) {
    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distance = distanceTime.distance.value;
    const time = distanceTime.duration.value;

    const VehicleCategory = require('../models/vehicleCategory.model');
    const categories = await VehicleCategory.find({ isActive: true });

    if (categories.length === 0) {
        throw new Error("Nenhuma categoria de veículo ativa configurada.");
    }

    const fare = {};
    const fareCard = {};
    const fareBreakdownData = {};
    const optionalPricesByCategory = {};

    for (const cat of categories) {
        // Uma leitura de configuração por categoria, reaproveitada nas duas simulações:
        // dinheiro e cartão são o mesmo instante, então têm que ver a mesma tarifa.
        // Também compensa a remoção do cache — sem isto seriam 8 consultas por
        // categoria em vez de 4.
        const configSnapshot = await PricingEngine.buildConfigSnapshot({
            vehicleType: cat.name,
            serviceKind: 'ride',
        });

        const cashCalc = await PricingEngine.calculateFare({
            distance,
            time,
            vehicleType: cat.name,
            paymentMethod: 'cash',
            configSnapshot,
        });
        fare[cat.name] = cashCalc.finalFare;

        // Salva breakdown do dinheiro para referência
        fareBreakdownData[cat.name] = {
            ...cashCalc.fareBreakdown,
            commissionPercent: cashCalc.commissionPercent,
        };

        const cardCalc = await PricingEngine.calculateFare({
            distance,
            time,
            vehicleType: cat.name,
            paymentMethod: 'card',
            configSnapshot,
        });
        fareCard[cat.name] = cardCalc.finalFare;
        optionalPricesByCategory[cat.name] = resolveOptionalPricesFromCategory(configSnapshot.category);
    }

    // Bloco H (2026-08-02, achado §6): showAsEstimate era salvo em Configurações e
    // nunca lido por nada — o app do passageiro sempre mostrava "valor estimado" fixo,
    // então o toggle nunca teve efeito nenhum, ligado ou desligado.
    const TariffSetting = require('../models/tariffSetting.model');
    const tariffSetting = await TariffSetting.findOne();
    const eta = await estimateEtaByVehicleType(pickup, categories.map((c) => c.name));

    const result = {
        fare,
        fareCard,
        distance,
        time,
        polyline: distanceTime.polyline,
        breakdown: fareBreakdownData,
        showAsEstimate: tariffSetting?.showAsEstimate ?? true,
        // Por categoria (fonte: VehicleCategory.pricing.optionals).
        optionalPricesByCategory,
        // Compat: primeira categoria ativa (Home deve preferir optionalPricesByCategory[vehicleType]).
        optionalPrices: optionalPricesByCategory[categories[0]?.name] || {},
        eta,
    };

    return result;
}

module.exports.getFare = getFare;

function getOtp(num) {
    function generateOtp(num) {
        return crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
    }
    return generateOtp(num);
}

module.exports.createRide = async ({
    user, pickup, destination, vehicleType, paymentMethod = 'cash', optionals = [], observation = '', useWalletBalance = false, requestFemaleDriver = false, promoCode = null, scheduledAt = null
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    let parsedSchedule = null;
    if (scheduledAt) {
        const scheduleService = require('./schedule.service');
        parsedSchedule = scheduleService.assertValidScheduledAt(scheduledAt);
    }

    {
        const dispatchService = require('./dispatch.service');
        const serviceKind = parsedSchedule ? 'scheduledRide' : 'ride';
        if (!(await dispatchService.isVehicleCategoryAllowed(vehicleType, serviceKind))) {
            const err = new Error('VEHICLE_CATEGORY_NOT_ALLOWED_FOR_SERVICE');
            err.code = 'VEHICLE_CATEGORY_NOT_ALLOWED_FOR_SERVICE';
            throw err;
        }
    }

    // Exclusão mútua user: não criar corrida imediata se há encomenda ativa.
    // Agendamento futuro não conflita com encomenda em andamento.
    if (!parsedSchedule) {
        const parcelModel = require('../models/parcel.model');
        const dispatchService = require('./dispatch.service');
        const activeParcel = await parcelModel.exists({
            user,
            status: {
                $in: [
                    'awaiting_provider',
                    ...dispatchService.ACTIVE_PARCEL_STATUSES,
                    'delivered',
                ],
            },
        });
        if (activeParcel) {
            const err = new Error('USER_HAS_ACTIVE_PARCEL');
            err.code = 'USER_HAS_ACTIVE_PARCEL';
            throw err;
        }
    }

    // Calcular rota e tempo real
    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distance = distanceTime.distance.value;
    const time = distanceTime.duration.value;

    // Congela a configuração de tarifa/comissão vigente agora (P2.2 da auditoria de
    // concorrência, 2026-08-02) — guardada na corrida e reutilizada em endRide, pra uma
    // mudança de tarifa feita pelo admin durante a corrida não alterar o valor que o
    // passageiro já viu e aceitou na confirmação.
    const pricingSnapshot = await PricingEngine.buildConfigSnapshot({
        vehicleType,
        serviceKind: 'ride',
    });

    // Processar opcionais para o PricingEngine (preços da categoria, não TariffSetting)
    const optionalsMap = {};
    const processedOptionals = [];
    const optionalPrices = resolveOptionalPricesFromCategory(pricingSnapshot?.category);

    if (Array.isArray(optionals)) {
        optionals.forEach(opt => {
            const type = typeof opt === 'string' ? opt : opt.type;
            if (!type) return;
            optionalsMap[type] = true;
            // Preservar array para retrocompatibilidade no schema do banco
            const price = Number(optionalPrices[type]) || 0;
            processedOptionals.push({ type, price });
        });
    }

    // Usar o Pricing Engine Oficial
    const pricing = await PricingEngine.calculateFare({
        distance,
        time,
        vehicleType,
        paymentMethod: paymentMethod === 'carteira' ? 'pix' : paymentMethod, // Use a fallback method for calculation if carteira
        configSnapshot: pricingSnapshot,
        serviceKind: 'ride',
        optionals: optionalsMap
    });

    let finalPrice = pricing.finalFare;

    // Fase 4 (agendamento): no booking NÃO debita carteira nem consome cupom.
    // Intenção de wallet/cupom fica guardada e é liquidada na ativação
    // (settleScheduledRideFinance). Fare/commission snapshot continua congelado aqui.
    const useWalletScheduled = !!(parsedSchedule && useWalletBalance);
    if (parsedSchedule) {
        useWalletBalance = false;
    }
    const promoCodeScheduled = (parsedSchedule && promoCode)
        ? String(promoCode).toUpperCase().trim()
        : null;

    // Bloco H (2026-08-02, achados F3/F4): aplica o cupom ANTES do desconto de carteira,
    // pra useWalletBalance cobrir o valor já com desconto, não o valor cheio. Um código
    // inválido/expirado/fora de regra não derruba a criação da corrida — só não aplica
    // desconto nenhum; o motivo vai em promoError pro frontend decidir como avisar.
    let discountAmount = 0;
    let promotionApplied = null;
    let promoError = null;
    if (promoCode) {
        const promotionService = require('./promotion.service');
        const result = await promotionService.findApplicablePromotion({
            code: promoCode,
            userId: user,
            vehicleType,
            paymentMethod: paymentMethod === 'carteira' ? 'pix' : paymentMethod,
            rideValue: finalPrice
        });
        if (result?.error) {
            promoError = result.error;
        } else if (result?.promotion) {
            discountAmount = result.discountAmount;
            promotionApplied = result.promotion._id;
            finalPrice -= discountAmount;
        }
    }

    let walletAmountUsed = 0;

    if (useWalletBalance) {
        const userData = await userModel.findById(user);
        if (userData && userData.walletBalance > 0) {
            if (userData.walletBalance >= finalPrice) {
                walletAmountUsed = finalPrice;
                paymentMethod = 'carteira'; // Fully paid with wallet
            } else {
                walletAmountUsed = userData.walletBalance;
            }
            userData.walletBalance -= walletAmountUsed;
            await userData.save();
        }
    }

    // Amount to be paid via normal method
    const paymentAmount = finalPrice - walletAmountUsed;

    // Agendadas: coords cedo para upcoming por raio (SCH-C3 / Fase 2.4). Imediatas: despacho grava.
    let pickupCoordinates;
    let destinationCoordinates;
    if (parsedSchedule) {
        try {
            const pickupCoord = await mapService.getAddressCoordinate(pickup);
            pickupCoordinates = { lat: pickupCoord.ltd, lng: pickupCoord.lng };
        } catch {
            pickupCoordinates = undefined;
        }
        try {
            const destCoord = await mapService.getAddressCoordinate(destination);
            destinationCoordinates = { lat: destCoord.ltd, lng: destCoord.lng };
        } catch {
            destinationCoordinates = undefined;
        }
    }

    const ride = await rideModel.create({
        user,
        pickup,
        destination,
        otp: getOtp(6),
        fare: pricing.finalFare,
        finalPrice: finalPrice,
        promotionApplied,
        discountAmount,
        walletAmountUsed,
        paymentMethod,
        optionals: processedOptionals,
        observation,
        requestFemaleDriver,
        vehicleType,
        source: 'passenger_requested',
        destinationPending: false,
        status: parsedSchedule ? 'scheduled' : 'requested',
        scheduledAt: parsedSchedule,
        promoCodeScheduled,
        useWalletScheduled,
        pickupCoordinates,
        destinationCoordinates,
        estimatedDistance: distance,
        estimatedTime: time,
        estimatedPriceMin: pricing.finalFare,
        estimatedPriceMax: pricing.finalFare,
        commissionPercent: pricing.commissionPercent ?? 0,
        commissionAmount: pricing.commissionAmount,
        fareBreakdown: pricing.fareBreakdown,
        pricingSnapshot,
        distance,
        duration: time
    });

    // Agendada: sem payment/captura e sem consumir cupom no booking (Fase 4).
    if (!parsedSchedule) {
        if (paymentAmount > 0 || walletAmountUsed > 0) {
            await paymentModel.create({
                rideId: ride._id,
                userId: user,
                amount: finalPrice,
                method: paymentMethod,
                status: paymentMethod === 'carteira' ? 'approved' : 'pending'
            });
        }

        if (promotionApplied) {
            const promotionService = require('./promotion.service');
            await promotionService.recordPromotionUsage({
                promotionId: promotionApplied,
                userId: user,
                rideId: ride._id,
                discountAmount
            });
        }
    }

    return { ride, promoError };
}

/**
 * Fase 4: liquida wallet/cupom/payment de corrida agendada na ativação (idempotente).
 * Não bloqueia o despacho se falhar parcialmente — grava o que conseguir e marca settled.
 */
module.exports.settleScheduledRideFinance = async (rideId) => {
    const ride = await rideModel.findOne({
        _id: rideId,
        scheduledAt: { $ne: null },
        scheduleFinanceSettledAt: null,
    });
    if (!ride) return null;

    const promotionService = require('./promotion.service');
    const promotionUsageModel = require('../models/promotionUsage.model');

    if (ride.promotionApplied && (ride.discountAmount || 0) > 0) {
        const already = await promotionUsageModel.exists({ rideId: ride._id });
        if (!already) {
            await promotionService.recordPromotionUsage({
                promotionId: ride.promotionApplied,
                userId: ride.user,
                rideId: ride._id,
                discountAmount: ride.discountAmount,
            });
        }
    } else if (ride.promoCodeScheduled && !ride.promotionApplied) {
        const base = (ride.fare || 0) + (Array.isArray(ride.optionals)
            ? ride.optionals.reduce((s, o) => s + (o.price || 0), 0)
            : 0);
        const result = await promotionService.findApplicablePromotion({
            code: ride.promoCodeScheduled,
            userId: ride.user,
            vehicleType: ride.vehicleType,
            paymentMethod: ride.paymentMethod === 'carteira' ? 'pix' : ride.paymentMethod,
            rideValue: base,
        });
        if (result?.promotion) {
            const discountAmount = result.discountAmount;
            const finalPrice = Math.max(0, base - discountAmount);
            await rideModel.updateOne(
                { _id: ride._id },
                {
                    $set: {
                        promotionApplied: result.promotion._id,
                        discountAmount,
                        finalPrice,
                    },
                }
            );
            ride.promotionApplied = result.promotion._id;
            ride.discountAmount = discountAmount;
            ride.finalPrice = finalPrice;
            await promotionService.recordPromotionUsage({
                promotionId: result.promotion._id,
                userId: ride.user,
                rideId: ride._id,
                discountAmount,
            });
        }
    }

    let walletAmountUsed = ride.walletAmountUsed || 0;
    let paymentMethod = ride.paymentMethod;
    const finalPrice = ride.finalPrice || ride.fare || 0;

    if (ride.useWalletScheduled && walletAmountUsed === 0 && finalPrice > 0) {
        const userData = await userModel.findById(ride.user);
        if (userData && userData.walletBalance > 0) {
            if (userData.walletBalance >= finalPrice) {
                walletAmountUsed = finalPrice;
                paymentMethod = 'carteira';
            } else {
                walletAmountUsed = userData.walletBalance;
            }
            userData.walletBalance -= walletAmountUsed;
            await userData.save();
        }
    }

    const paymentAmount = finalPrice - walletAmountUsed;
    const hasPayment = await paymentModel.exists({ rideId: ride._id });
    if (!hasPayment && (paymentAmount > 0 || walletAmountUsed > 0)) {
        await paymentModel.create({
            rideId: ride._id,
            userId: ride.user,
            amount: finalPrice,
            method: paymentMethod,
            status: paymentMethod === 'carteira' ? 'approved' : 'pending',
        });
    }

    return rideModel.findOneAndUpdate(
        { _id: rideId, scheduleFinanceSettledAt: null },
        {
            $set: {
                scheduleFinanceSettledAt: new Date(),
                walletAmountUsed,
                paymentMethod,
            },
        },
        { new: true }
    );
};

function isValidGpsCoord(lat, lng) {
    return Number.isFinite(lat)
        && Number.isFinite(lng)
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180
        && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

function resolveCaptainOrigin(captainDoc, clientLat, clientLng) {
    const storedLat = captainDoc?.location?.ltd;
    const storedLng = captainDoc?.location?.lng;
    const clientOk = isValidGpsCoord(clientLat, clientLng);
    const storedOk = isValidGpsCoord(storedLat, storedLng);

    if (clientOk && storedOk) {
        const jumpKm = mapService.haversineKm(storedLat, storedLng, clientLat, clientLng);
        // Aceita o GPS fresco do app só se estiver coerente com a última posição do backend.
        if (jumpKm <= 2) {
            return { lat: clientLat, lng: clientLng, from: 'client_validated' };
        }
        return { lat: storedLat, lng: storedLng, from: 'server' };
    }
    if (clientOk) return { lat: clientLat, lng: clientLng, from: 'client' };
    if (storedOk) return { lat: storedLat, lng: storedLng, from: 'server' };
    return null;
}

// Corrida presencial iniciada pelo motorista — reutiliza PricingEngine/OTP/busyLock/
// índice de corrida ativa. Nunca despacha (source=driver_initiated + status=accepted).
module.exports.createPresentialRide = async ({
    captain,
    destination = null,
    destinationPending = false,
    paymentMethod = 'cash',
    passengerPhone = null,
    clientLat = null,
    clientLng = null,
}) => {
    if (!captain) {
        throw new Error('Captain is required');
    }
    if (!destinationPending && (!destination || String(destination).trim().length < 3)) {
        throw new Error('Destination is required when not pending');
    }
    if (destinationPending && destination) {
        throw new Error('Do not send destination when destinationPending is true');
    }

    // Auditoria C3: presencial só liquidação em dinheiro no local até existir cobrança
    // Asaas/carteira dedicada. Aceitar card/carteira creditava wallet sem gateway.
    const normalizedPayment = String(paymentMethod || 'cash').toLowerCase();
    if (normalizedPayment !== 'cash') {
        const err = new Error('PRESENTIAL_CASH_ONLY');
        err.code = 'PRESENTIAL_CASH_ONLY';
        throw err;
    }
    paymentMethod = 'cash';

    if (captain.approvalStatus !== 'aprovado' || captain.isBlocked || captain.canReceiveRides === false) {
        const err = new Error('CAPTAIN_NOT_ALLOWED');
        err.code = 'CAPTAIN_NOT_ALLOWED';
        throw err;
    }

    const captainModel = require('../models/captain.model');
    const freshCaptain = await captainModel.findById(captain._id);
    if (!freshCaptain) {
        throw new Error('Captain not found');
    }
    if (freshCaptain.approvalStatus !== 'aprovado' || freshCaptain.isBlocked || freshCaptain.canReceiveRides === false) {
        const err = new Error('CAPTAIN_NOT_ALLOWED');
        err.code = 'CAPTAIN_NOT_ALLOWED';
        throw err;
    }

    const vehicleType = freshCaptain.vehicle?.vehicleType;
    if (!vehicleType) {
        throw new Error('Captain vehicle category is required');
    }

    const origin = resolveCaptainOrigin(freshCaptain, clientLat, clientLng);
    if (!origin) {
        const err = new Error('INVALID_CAPTAIN_LOCATION');
        err.code = 'INVALID_CAPTAIN_LOCATION';
        throw err;
    }

    // Persiste a origem usada na criação (auditoria + tracking).
    await captainModel.findByIdAndUpdate(freshCaptain._id, {
        location: { ltd: origin.lat, lng: origin.lng },
        locationGeoJSON: { type: 'Point', coordinates: [ origin.lng, origin.lat ] },
        lastSeenAt: new Date(),
    });

    let pickupAddress;
    try {
        const rev = await mapService.getReverseGeocode(origin.lat, origin.lng);
        pickupAddress = rev?.address || `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`;
    } catch {
        pickupAddress = `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`;
    }

    // Auditoria A2: não aceitar passengerUserId arbitrário do client (IDOR de vínculo).
    // Só associa passageiro se o telefone existir no cadastro (opt-in fraco, sem ObjectId livre).
    let linkedUserId = null;
    if (passengerPhone) {
        const phone = String(passengerPhone).trim();
        const found = await userModel.findOne({ phone }).select('_id');
        if (found) linkedUserId = found._id;
    }

    if (linkedUserId) {
        const parcelModel = require('../models/parcel.model');
        const dispatchService = require('./dispatch.service');
        const activeParcel = await parcelModel.exists({
            user: linkedUserId,
            status: {
                $in: [
                    'awaiting_provider',
                    ...dispatchService.ACTIVE_PARCEL_STATUSES,
                    'delivered',
                ],
            },
        });
        if (activeParcel) {
            const err = new Error('USER_HAS_ACTIVE_PARCEL');
            err.code = 'USER_HAS_ACTIVE_PARCEL';
            throw err;
        }
        const activeUserRide = await rideModel.exists({
            user: linkedUserId,
            status: { $in: [ 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ] },
        });
        if (activeUserRide) {
            const err = new Error('USER_HAS_ACTIVE_RIDE');
            err.code = 'USER_HAS_ACTIVE_RIDE';
            throw err;
        }
    }

    const dispatchService = require('./dispatch.service');
    if (await dispatchService.captainHasActiveParcel(freshCaptain._id)) {
        const err = new Error('CAPTAIN_BUSY');
        err.code = 'CAPTAIN_BUSY';
        throw err;
    }

    // Cancela via admin (e outros caminhos que esqueciam o unlock) deixavam busyLock
    // true sem ride/parcel ativos — limpa o lock órfão antes de tentar adquirir.
    await dispatchService.releaseCaptainBusyLockIfIdle(freshCaptain._id);

    const locked = await dispatchService.acquireCaptainBusyLock(freshCaptain._id);
    if (!locked) {
        const err = new Error('CAPTAIN_BUSY');
        err.code = 'CAPTAIN_BUSY';
        throw err;
    }

    let presentialCreatedId = null;
    try {
        const existingActive = await rideModel.exists({
            captain: freshCaptain._id,
            status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ] },
        });
        if (existingActive) {
            const err = new Error('CAPTAIN_BUSY');
            err.code = 'CAPTAIN_BUSY';
            throw err;
        }

        const pricingSnapshot = await PricingEngine.buildConfigSnapshot({
            vehicleType,
            serviceKind: 'presential',
        });
        const otp = getOtp(6);
        const originTimestamp = new Date();

        let fare = 0;
        let finalPrice = 0;
        let estimatedDistance = 0;
        let estimatedTime = 0;
        let fareBreakdown = null;
        let commissionAmount = 0;
        let commissionPercent = 0;
        let destinationCoords = null;
        let destinationMeta = undefined;
        let destinationValue = undefined;

        if (!destinationPending) {
            const distanceTime = await mapService.getDistanceTime(
                `${origin.lat},${origin.lng}`,
                destination
            );
            estimatedDistance = distanceTime.distance.value;
            estimatedTime = distanceTime.duration.value;

            const pricing = await PricingEngine.calculateFare({
                distance: estimatedDistance,
                time: estimatedTime,
                vehicleType,
                paymentMethod: paymentMethod === 'carteira' ? 'pix' : paymentMethod,
                configSnapshot: pricingSnapshot,
                serviceKind: 'presential',
            });
            fare = pricing.finalFare;
            finalPrice = pricing.finalFare;
            fareBreakdown = pricing.fareBreakdown;
            commissionAmount = pricing.commissionAmount;
            commissionPercent = pricing.commissionPercent ?? 0;

            try {
                const dest = await mapService.getAddressCoordinate(destination);
                if (dest && isValidGpsCoord(dest.ltd, dest.lng)) {
                    destinationCoords = { lat: dest.ltd, lng: dest.lng };
                    destinationMeta = {
                        coordinates: [ dest.lng, dest.ltd ],
                        timestamp: originTimestamp,
                        source: 'user_provided',
                    };
                }
            } catch {
                // Destino textual ainda é válido; coords opcionais.
            }
            destinationValue = String(destination).trim();
        } else {
            // Sem destino: congela snapshot; preço real só no endRide via GPS + PricingEngine.
            // Não chama calculateFare(0) — isso retornaria minFare e enganaria a UI.
            fare = 0;
            finalPrice = 0;
            fareBreakdown = { pendingDestination: true, serviceKind: 'presential' };
            commissionAmount = 0;
            commissionPercent = pricingSnapshot?.commissionPercent
                ?? pricingSnapshot?.globalSetting?.platformCommissions?.presential
                ?? pricingSnapshot?.globalSetting?.platformCommission
                ?? 20;
        }

        const ridePayload = {
            user: linkedUserId || undefined,
            captain: freshCaptain._id,
            pickup: pickupAddress,
            pickupCoordinates: { lat: origin.lat, lng: origin.lng },
            origin: {
                coordinates: [ origin.lng, origin.lat ],
                address: pickupAddress,
                timestamp: originTimestamp,
            },
            otp,
            fare,
            finalPrice,
            paymentMethod,
            vehicleType,
            source: 'driver_initiated',
            destinationPending: !!destinationPending,
            status: 'accepted',
            estimatedDistance,
            estimatedTime,
            estimatedPriceMin: fare,
            estimatedPriceMax: fare,
            commissionPercent,
            commissionAmount,
            fareBreakdown,
            pricingSnapshot,
            distance: estimatedDistance,
            duration: estimatedTime,
            lastLocation: { lat: origin.lat, lng: origin.lng },
            actualDistance: 0,
        };

        if (destinationValue) {
            ridePayload.destination = destinationValue;
        }
        if (destinationCoords) {
            ridePayload.destinationCoordinates = destinationCoords;
        }
        if (destinationMeta) {
            ridePayload.destinationMeta = destinationMeta;
        }

        const ride = await rideModel.create(ridePayload);
        presentialCreatedId = ride._id;

        try {
            if (linkedUserId && finalPrice > 0) {
                await paymentModel.create({
                    rideId: ride._id,
                    userId: linkedUserId,
                    amount: finalPrice,
                    method: paymentMethod,
                    status: 'pending',
                });
            }

            return await rideModel.findById(ride._id)
                .populate('user', USER_IDENTITY_FIELDS)
                .populate('captain', CAPTAIN_IDENTITY_FIELDS)
                .select('+otp');
        } catch (postCreateErr) {
            // Corrida já existe e ocupa o captain — mantém busyLock e devolve a ride.
            console.error('[AUDIT] createPresentialRide pós-create:', postCreateErr);
            return rideModel.findById(ride._id)
                .populate('user', USER_IDENTITY_FIELDS)
                .populate('captain', CAPTAIN_IDENTITY_FIELDS)
                .select('+otp');
        }
    } catch (err) {
        // Só libera o lock se a corrida NÃO chegou a ser criada.
        if (!presentialCreatedId) {
            await dispatchService.releaseCaptainBusyLock(freshCaptain._id);
        }
        // Índice único captain_active_ride_unique
        if (err && err.code === 11000) {
            const busy = new Error('CAPTAIN_BUSY');
            busy.code = 'CAPTAIN_BUSY';
            throw busy;
        }
        throw err;
    }
};

module.exports.estimatePresentialFare = async ({ captain, destination, clientLat = null, clientLng = null }) => {
    if (!captain || !destination) {
        throw new Error('Captain and destination are required');
    }
    const captainModel = require('../models/captain.model');
    const freshCaptain = await captainModel.findById(captain._id);
    if (!freshCaptain) throw new Error('Captain not found');

    const origin = resolveCaptainOrigin(freshCaptain, clientLat, clientLng);
    if (!origin) {
        const err = new Error('INVALID_CAPTAIN_LOCATION');
        err.code = 'INVALID_CAPTAIN_LOCATION';
        throw err;
    }

    const vehicleType = freshCaptain.vehicle?.vehicleType;
    if (!vehicleType) throw new Error('Captain vehicle category is required');

    const distanceTime = await mapService.getDistanceTime(
        `${origin.lat},${origin.lng}`,
        destination
    );
    const pricingSnapshot = await PricingEngine.buildConfigSnapshot({
        vehicleType,
        serviceKind: 'presential',
    });
    const pricing = await PricingEngine.calculateFare({
        distance: distanceTime.distance.value,
        time: distanceTime.duration.value,
        vehicleType,
        paymentMethod: 'cash',
        configSnapshot: pricingSnapshot,
        serviceKind: 'presential',
    });

    return {
        pickupCoordinates: { lat: origin.lat, lng: origin.lng },
        estimatedDistance: distanceTime.distance.value,
        estimatedTime: distanceTime.duration.value,
        fare: pricing.finalFare,
        fareBreakdown: pricing.fareBreakdown,
        vehicleType,
    };
};

// Único caminho de aceite de corrida no sistema (P1.3 da auditoria de concorrência,
// 2026-08-01) — usado tanto por POST /rides/:id/accept quanto por POST /rides/confirm
// (mantida como alias de compatibilidade no controller). Antes existiam dois caminhos:
// este, atômico, e um segundo em ride.service.js (`confirmRide`, removido) que fazia
// `findOneAndUpdate({_id})` sem checar status — dois motoristas aceitando a mesma
// corrida recebiam 200 os dois, e o segundo aceite conseguia rebaixar até uma corrida
// já `finished`/`cancelled` de volta pra `accepted`. O filtro `status:'requested'`
// abaixo é a garantia real: só um `findOneAndUpdate` ganha a corrida.
/** ACK de recusa da oferta — não altera status da corrida (igual parcel.declineParcel). */
module.exports.declineRide = async ({ rideId, captain }) => {
    console.log(`[RIDE] Captain ${captain?._id} declined offer ${rideId} (ACK only)`);
    return { ok: true };
};

module.exports.acceptRideAtomic = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    // Exclusão mútua ride↔parcel: busyLock atômico + recheck dentro da seção crítica.
    const dispatchService = require('./dispatch.service');
    const locked = await dispatchService.acquireCaptainBusyLock(captain._id);
    if (!locked) {
        throw new Error('CAPTAIN_ALREADY_HAS_ACTIVE_RIDE');
    }

    let updatedRide;
    try {
        if (await dispatchService.captainHasActiveParcel(captain._id)) {
            throw new Error('CAPTAIN_ALREADY_HAS_ACTIVE_RIDE');
        }
        if (await dispatchService.captainHasActiveRide(captain._id)) {
            throw new Error('CAPTAIN_ALREADY_HAS_ACTIVE_RIDE');
        }

        updatedRide = await transitionRide(rideId, 'accepted', {}, { captain: captain._id });
    } catch (err) {
        await dispatchService.releaseCaptainBusyLock(captain._id);
        // Índice único parcial em ride.model.js (C2 da auditoria de concorrência): este
        // motorista já tem outra corrida ativa. Erro de chave duplicada do Mongo, não uma
        // falha de servidor — traduzido pra uma mensagem que o app sabe mostrar.
        if (err.code === 11000) {
            throw new Error('CAPTAIN_ALREADY_HAS_ACTIVE_RIDE');
        }
        throw err;
    }

    if (!updatedRide) {
        await dispatchService.releaseCaptainBusyLock(captain._id);
        // Find out if it doesn't exist, foi cancelada, ou já foi aceita.
        //
        // Diagnóstico de push de corrida (2026-08-03), achado 4: antes, qualquer motivo
        // de falha aqui virava "RIDE_ALREADY_ACCEPTED" — incluindo quando o passageiro
        // tinha CANCELADO a corrida, não quando outro motorista aceitou primeiro. O
        // motorista via "outro motorista aceitou" mesmo quando isso nunca aconteceu.
        const existingRide = await rideModel.findById(rideId);
        if (!existingRide) {
            throw new Error('RIDE_NOT_FOUND');
        }
        if (existingRide.status === 'cancelled') {
            throw new Error('RIDE_CANCELLED');
        }
        throw new Error('RIDE_ALREADY_ACCEPTED');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user', USER_IDENTITY_FIELDS).populate('captain', CAPTAIN_IDENTITY_FIELDS).select('+otp');

    return ride;
}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }
    if (!captain?._id) {
        throw new Error('Captain is required');
    }

    // Pré-checagem só pra mensagens de erro precisas (OTP errado vs. corrida em estado
    // errado) — a garantia real de concorrência é o findOneAndUpdate atômico abaixo.
    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id,
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (!VALID_ORIGINS_BY_TARGET.started.includes(ride.status)) {
        throw new Error('Ride not accepted');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    let waitTimeSeconds = 0;
    if (ride.arrivedAt) {
        waitTimeSeconds = Math.max(0, (Date.now() - ride.arrivedAt.getTime()) / 1000);
    }

    const updatedRide = await transitionRide(rideId, 'started', { otp, captain: captain._id }, {
        waitTimeSeconds,
        startedAt: new Date(),
        // Inicia o tracking de distância a partir do GPS atual do motorista, se houver.
        ...(ride.captain?.location?.ltd != null && ride.captain?.location?.lng != null
            ? { lastLocation: { lat: ride.captain.location.ltd, lng: ride.captain.location.lng } }
            : {}),
    });
    if (!updatedRide) {
        throw new Error('Ride not accepted');
    }

    return rideModel.findOne({ _id: rideId }).populate('user').populate('captain').select('+otp');
}

// Só cobre as transições de deslocamento do motorista até o embarque (a caminho /
// cheguei). 'started'/'finished'/'cancelled' têm funções dedicadas (startRide/endRide/
// cancelRide) com validação de OTP, cálculo de tarifa e efeitos de carteira que este
// endpoint genérico não faz — permitir esses destinos aqui seria uma forma de
// contorná-los (P2.1 da auditoria de concorrência: nenhum endpoint deve conseguir
// aplicar uma transição de status sem passar pela lógica que ela exige).
const UPDATE_STATUS_ALLOWED_TARGETS = ['going_to_pickup', 'arrived', 'waiting_passenger'];

module.exports.updateRideStatus = async ({ rideId, captain, status }) => {
    if (!rideId || !status) {
        throw new Error('Ride id and status are required');
    }

    if (!UPDATE_STATUS_ALLOWED_TARGETS.includes(status)) {
        throw new Error('Invalid status');
    }

    const extraSet = {};
    if (status === 'arrived') {
        extraSet.arrivedAt = new Date();
    }

    const ride = await transitionRide(rideId, status, { captain: captain._id }, extraSet);

    if (!ride) {
        throw new Error('Ride not found or invalid transition');
    }

    return rideModel.findOne({ _id: rideId }).populate('user').populate('captain').select('+otp');
}

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    // 'ongoing' nunca existiu no enum de status (Backend/models/ride.model.js) — checagem
    // morta removida, `started` é a única origem real de `finished`.
    if (!VALID_ORIGINS_BY_TARGET.finished.includes(ride.status)) {
        throw new Error('Ride not started');
    }

    const finishExtras = {};
    const isPresentialPendingDest = !!(ride.destinationPending || (ride.source === 'driver_initiated' && !ride.destination));

    // Corrida presencial sem destino: destino = última GPS válida do motorista.
    if (isPresentialPendingDest) {
        const captainModel = require('../models/captain.model');
        const freshCaptain = await captainModel.findById(captain._id).select('location lastSeenAt');
        const gpsLat = ride.lastLocation?.lat ?? freshCaptain?.location?.ltd;
        const gpsLng = ride.lastLocation?.lng ?? freshCaptain?.location?.lng;

        if (!isValidGpsCoord(gpsLat, gpsLng)) {
            const err = new Error('INVALID_FINISH_LOCATION');
            err.code = 'INVALID_FINISH_LOCATION';
            throw err;
        }

        // Auditoria A4: exige contato GPS recente (lastSeenAt) — sem isso o finish
        // usava a origem gravada na criação e gerava preço 0.
        const lastSeenMs = freshCaptain?.lastSeenAt ? new Date(freshCaptain.lastSeenAt).getTime() : 0;
        if (!lastSeenMs || (Date.now() - lastSeenMs) > 120000) {
            const err = new Error('STALE_FINISH_LOCATION');
            err.code = 'STALE_FINISH_LOCATION';
            throw err;
        }

        const originLat = ride.pickupCoordinates?.lat ?? ride.origin?.coordinates?.[1];
        const originLng = ride.pickupCoordinates?.lng ?? ride.origin?.coordinates?.[0];
        if (isValidGpsCoord(originLat, originLng)) {
            const movedKm = mapService.haversineKm(originLat, originLng, gpsLat, gpsLng);
            // Sem tracking e quase parado no ponto de origem → não inventar destino/preço.
            if (!(ride.actualDistance > 50) && movedKm < 0.05) {
                const err = new Error('INSUFFICIENT_TRIP_DISTANCE');
                err.code = 'INSUFFICIENT_TRIP_DISTANCE';
                throw err;
            }
        }

        let destAddress;
        try {
            const rev = await mapService.getReverseGeocode(gpsLat, gpsLng);
            destAddress = rev?.address || `${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}`;
        } catch {
            destAddress = `${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}`;
        }

        finishExtras.destination = destAddress;
        finishExtras.destinationPending = false;
        finishExtras.destinationCoordinates = { lat: gpsLat, lng: gpsLng };
        finishExtras.destinationMeta = {
            coordinates: [ gpsLng, gpsLat ],
            timestamp: new Date(),
            source: 'gps_at_finish',
        };

        // Se o tracking GPS não acumulou distância útil, usa rota origem→destino real.
        if (!(ride.actualDistance > 0) && isValidGpsCoord(originLat, originLng)) {
            try {
                const route = await mapService.getDistanceTime(
                    `${originLat},${originLng}`,
                    `${gpsLat},${gpsLng}`
                );
                if (route?.distance?.value > 0) {
                    finishExtras.actualDistance = route.distance.value;
                    ride.actualDistance = route.distance.value;
                }
            } catch (e) {
                console.error('Erro calculando rota no fim da presencial sem destino:', e);
                const err = new Error('ROUTE_CALCULATION_FAILED');
                err.code = 'ROUTE_CALCULATION_FAILED';
                throw err;
            }
        }
    }

    const actualDistance = finishExtras.actualDistance ?? ride.actualDistance ?? 0;
    // Prefer startedAt (quando a corrida de fato começou); fallback createdAt.
    const timeBase = ride.startedAt || ride.createdAt;
    let actualTimeSeconds = Math.round((Date.now() - new Date(timeBase).getTime()) / 1000);
    if (actualTimeSeconds < 60 && ride.estimatedTime) actualTimeSeconds = ride.estimatedTime;

    // Auditoria C2: presencial sem destino não pode fechar com distância 0 / preço 0.
    if (isPresentialPendingDest && !(actualDistance > 0)) {
        const err = new Error('INSUFFICIENT_TRIP_DISTANCE');
        err.code = 'INSUFFICIENT_TRIP_DISTANCE';
        throw err;
    }

    let finalPrice = ride.fare;
    let pricingUpdate = {};
    const mustRecalculatePrice = actualDistance > 0 || isPresentialPendingDest;
    if (mustRecalculatePrice) {
        if (!(actualDistance > 0)) {
            const err = new Error('INSUFFICIENT_TRIP_DISTANCE');
            err.code = 'INSUFFICIENT_TRIP_DISTANCE';
            throw err;
        }
        try {
            const optionalsMap = {};
            if (Array.isArray(ride.optionals)) {
                ride.optionals.forEach(opt => {
                    const type = typeof opt === 'string' ? opt : opt.type;
                    if (type) optionalsMap[type] = true;
                });
            }

            const endServiceKind = ride.source === 'driver_initiated' ? 'presential' : 'ride';
            const pricing = await PricingEngine.calculateFare({
                distance: actualDistance,
                time: actualTimeSeconds,
                vehicleType: ride.vehicleType,
                paymentMethod: ride.paymentMethod === 'carteira' ? 'pix' : (ride.paymentMethod || 'cash'),
                // Recalcula com a tarifa/comissão CONGELADAS no momento em que a corrida foi
                // pedida (P2.2 da auditoria de concorrência) — só distância/tempo variam pro
                // valor real. Sem isso, uma mudança de tarifa feita pelo admin enquanto a
                // corrida estava em andamento mudava o preço cobrado no final.
                // `|| null` cobre corridas criadas antes desta mudança (sem snapshot
                // guardado) — cai de volta pro comportamento antigo (config vigente).
                configSnapshot: ride.pricingSnapshot || null,
                serviceKind: endServiceKind,
                waitTimeSeconds: ride.waitTimeSeconds || 0,
                optionals: optionalsMap
            });
            finalPrice = pricing.finalFare;
            pricingUpdate = {
                fareBreakdown: pricing.fareBreakdown,
                commissionAmount: pricing.commissionAmount,
                commissionPercent: pricing.commissionPercent ?? ride.commissionPercent,
            };
        } catch (e) {
            // Auditoria A3: não engolir falha de pricing — especialmente presencial.
            if (e.code === 'INSUFFICIENT_TRIP_DISTANCE' || e.code === 'ROUTE_CALCULATION_FAILED') {
                throw e;
            }
            console.error('Erro recalculando tarifa no final da corrida:', e);
            if (isPresentialPendingDest || ride.source === 'driver_initiated') {
                const err = new Error('PRICING_FAILED');
                err.code = 'PRICING_FAILED';
                throw err;
            }
        }
    }

    if (isPresentialPendingDest && !(finalPrice > 0)) {
        const err = new Error('PRICING_FAILED');
        err.code = 'PRICING_FAILED';
        throw err;
    }

    // Adicionais já embutidos no finalPrice via Unified Pricing Engine.

    const updated = await transitionRide(rideId, 'finished', { captain: captain._id }, {
        actualTime: actualTimeSeconds,
        finalPrice: finalPrice,
        paymentStatus: 'pending', // Awaiting driver to confirm cash received
        actualDistance,
        ...finishExtras,
        ...pricingUpdate,
    });
    if (!updated) {
        throw new Error('Ride not started');
    }

    // Garante registro de pagamento (presencial sem user/estimativa inicial).
    if (ride.user) {
        const existingPayment = await paymentModel.findOne({ rideId });
        if (!existingPayment) {
            await paymentModel.create({
                rideId,
                userId: ride.user._id || ride.user,
                amount: finalPrice,
                method: ride.paymentMethod || 'cash',
                status: 'pending',
            });
        } else if (existingPayment.amount !== finalPrice) {
            existingPayment.amount = finalPrice;
            await existingPayment.save();
        }
    } else {
        const existingPayment = await paymentModel.findOne({ rideId });
        if (!existingPayment) {
            await paymentModel.create({
                rideId,
                amount: finalPrice,
                method: ride.paymentMethod || 'cash',
                status: 'pending',
            });
        } else if (existingPayment.amount !== finalPrice) {
            existingPayment.amount = finalPrice;
            await existingPayment.save();
        }
    }

    const dispatchService = require('./dispatch.service');
    await dispatchService.releaseCaptainBusyLock(captain._id);

    const updatedRide = await rideModel.findById(rideId).populate('user').populate('captain');
    return updatedRide;
}

// Idempotente e transacional (P1.1 da auditoria de concorrência, 2026-08-01): duas
// chamadas concorrentes (duplo clique, retry de rede) não podem creditar o motorista
// duas vezes. A marcação paymentStatus:'paid' é o "claim" da operação — só quem
// consegue gravá-la de fato move dinheiro. Tudo roda dentro de uma transação Mongo;
// se qualquer passo falhar, nada é aplicado. `session.withTransaction` já faz retry
// automático de conflitos transitórios (duas transações disputando o mesmo documento),
// então uma corrida perdida na gravação cai de volta na pré-checagem, que já vê o
// resultado da outra transação após o commit dela.
module.exports.confirmPaymentReceived = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const walletService = require('./wallet.service');
    const captainModel = require('../models/captain.model');

    const session = await mongoose.startSession();
    let sideEffectCallbacks = [];
    let finalFare;

    try {
        await session.withTransaction(async () => {
            sideEffectCallbacks = [];

            const existing = await rideModel.findOne({
                _id: rideId,
                captain: captain._id
            }).session(session);

            if (!existing) {
                throw new Error('Ride not found');
            }
            if (existing.status !== 'finished') {
                throw new Error('Ride not finished yet');
            }
            if (existing.paymentStatus === 'paid') {
                throw new Error('Payment already confirmed');
            }

            // Guarda atômica: só segue se ainda ninguém marcou como paga entre a leitura
            // acima e este update. Em concorrência real isso normalmente nem dispara —
            // o WriteConflict do Mongo já força um retry que refaz a pré-checagem acima.
            const claimed = await rideModel.findOneAndUpdate(
                { _id: rideId, captain: captain._id, status: 'finished', paymentStatus: { $ne: 'paid' } },
                { $set: { paymentStatus: 'paid' } },
                { new: true, session }
            );
            if (!claimed) {
                throw new Error('Payment already confirmed');
            }

            finalFare = claimed.finalPrice || claimed.fare;

            if (claimed.paymentMethod === 'card') {
                // Se for cartão, credita o valor líquido no pendingBalance do motorista.
                // A plataforma processou via Asaas.
                const driverNetEarnings = finalFare - claimed.commissionAmount;

                const result = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'ride_payment',
                    paymentMethod: 'card',
                    amount: driverNetEarnings,
                    description: `Repasse da Corrida #${claimed._id.toString().slice(-6)} (Cartão)`,
                    session
                });
                sideEffectCallbacks.push(result.applySideEffects);
            } else {
                // Se for dinheiro ou pix, motorista fica com o valor total e descontamos a comissão
                const result1 = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'ride_payment',
                    paymentMethod: claimed.paymentMethod,
                    amount: finalFare,
                    description: `Corrida #${claimed._id.toString().slice(-6)} (${claimed.paymentMethod})`,
                    session
                });
                sideEffectCallbacks.push(result1.applySideEffects);

                const result2 = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'commission',
                    paymentMethod: 'wallet',
                    amount: claimed.commissionAmount,
                    description: `Comissão corrida #${claimed._id.toString().slice(-6)} (${claimed.commissionPercent}%)`,
                    session
                });
                sideEffectCallbacks.push(result2.applySideEffects);
            }

            // Bloco H (2026-08-02, achados F3/F4): se um cupom do admin descontou esta
            // corrida, o motorista não é quem paga essa conta — a plataforma absorve o
            // desconto (contabilizado no orçamento da promoção, ver promotion.service.js),
            // e o motorista recebe aqui exatamente o que receberia sem a promoção.
            if (claimed.discountAmount > 0) {
                const bonusResult = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'bonus',
                    paymentMethod: 'wallet',
                    amount: claimed.discountAmount,
                    description: `Compensação de cupom — Corrida #${claimed._id.toString().slice(-6)}`,
                    session
                });
                sideEffectCallbacks.push(bonusResult.applySideEffects);
            }

            await captainModel.findByIdAndUpdate(captain._id, {
                $inc: { totalRides: 1, earnings: finalFare }
            }, { session });

            // Alinha coleção payment com o status da ride (auditoria ledger).
            await paymentModel.updateMany(
                { rideId: claimed._id },
                { $set: { status: 'approved', amount: finalFare } },
                { session }
            );

            // Update User CRM fields (presencial pode não ter passageiro cadastrado)
            if (existing.user) {
                await userModel.findByIdAndUpdate(existing.user, {
                    $inc: { totalRides: 1, totalSpent: finalFare, totalDistance: claimed.actualDistance || claimed.distance || 0 },
                    $set: { lastRideAt: new Date() }
                }, { session });
            }
        });
    } finally {
        await session.endSession();
    }

    // Efeitos colaterais (socket + invalidação de cache) só depois do commit — emiti-los
    // de dentro da transação avisaria o motorista de um dinheiro que pode nunca ter sido
    // efetivado, se ela abortasse.
    for (const applySideEffects of sideEffectCallbacks) {
        await applySideEffects();
    }

    const updatedRide = await rideModel.findById(rideId).populate('user').populate('captain');
    return updatedRide;
}

module.exports.payRide = async ({ rideId, user }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const crypto = require('crypto');
    const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
    const orderId = 'order_' + crypto.randomBytes(8).toString('hex');
    const signature = crypto.randomBytes(16).toString('hex');

    const ride = await rideModel.findOneAndUpdate({
        _id: rideId,
        user: user._id
    }, {
        paymentID: paymentId,
        orderId: orderId,
        signature: signature
    }, { new: true }).populate('user').populate('captain');

    if (!ride) {
        throw new Error('Ride not found');
    }

    return ride;
}

module.exports.getCurrentRide = async ({ user }) => {
    if (!user) {
        throw new Error('User is required');
    }

    // Fase A da experiência de corrida ativa (2026-08-03): '+otp' porque o PIN pertence
    // ao próprio passageiro — sem isso, a restauração pós-refresh reconstruía a tela de
    // espera mas o PIN vinha vazio (otp tem select:false no model), e o motorista não
    // conseguia mais iniciar a corrida.
    let ride = await rideModel.findOne({
        user,
        status: { $in: [ 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing' ] }
    }).populate('user', USER_IDENTITY_FIELDS).populate('captain', CAPTAIN_IDENTITY_FIELDS).select('+otp');

    // Auto-expire stale 'requested' rides (older than 10 minutes)
    //
    // Implementação do sistema de cancelamento (2026-08-04): antes fazia
    // `ride.status = 'cancelled'; ride.save()` — exatamente o padrão "ler → verificar →
    // salvar" que o resto deste arquivo eliminou (comentário no topo do arquivo, P2.1 da
    // auditoria de concorrência). Uma corrida podia ser aceita por um motorista bem no
    // instante em que este código expirava ela, e o `.save()` sobrescreveria esse aceite
    // sem checar nada. Migrado pra transitionRide: o filtro `status:'requested'` no
    // próprio findOneAndUpdate garante que só expira se ainda estiver mesmo pendente.
    if (ride && ride.status === 'requested') {
        // SCH-C1: pós-ativação de agendada usa activatedAt; imediata usa createdAt.
        const clock = ride.activatedAt || ride.createdAt;
        const diffInMinutes = (Date.now() - new Date(clock).getTime()) / 60000;
        if (diffInMinutes > 10) {
            await transitionRide(ride._id, 'cancelled', {}, {
                cancelledBy: 'system',
                cancellationReason: 'Nenhum motorista aceitou a corrida a tempo',
                cancelledAt: new Date(),
            });
            ride = null;
        }
    }

    return ride;
}

// Auditoria de UX do motorista (2026-08-02): não existia equivalente de getCurrentRide
// para o motorista — um refresh de página (ou o app derrubado em segundo plano) durante
// uma corrida ativa perdia todo o estado, porque CaptainRiding.jsx dependia só do
// location.state do react-router, que não sobrevive a um reload.
module.exports.getCurrentRideForCaptain = async ({ captain }) => {
    if (!captain) {
        throw new Error('Captain is required');
    }

    // OTP só é necessário na restauração de corrida presencial (motorista mostra o PIN).
    // Em corrida normal o PIN pertence ao passageiro — expor aqui quebrava o consentimento
    // (auditoria presencial C1, 2026-08-04).
    const ride = await rideModel.findOne({
        captain,
        status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ] }
    }).populate('user', USER_IDENTITY_FIELDS).populate('captain', CAPTAIN_IDENTITY_FIELDS);

    if (!ride) return ride;

    if (ride.source === 'driver_initiated') {
        return rideModel.findById(ride._id)
            .populate('user', USER_IDENTITY_FIELDS)
            .populate('captain', CAPTAIN_IDENTITY_FIELDS)
            .select('+otp');
    }

    return ride;
}

// Aba "Corridas" do motorista (2026-08-04): o frontend já chamava
// GET /rides/captain-history, mas a rota nunca existiu — a tela só via erro/vazio.
// Resposta em três blocos pra a corrida ativa e as ofertas nunca sumirem atrás da
// paginação do histórico (finished/cancelled).
module.exports.getCaptainRideHistory = async ({ captain, page = 1, limit = 20 }) => {
    if (!captain) {
        throw new Error('Captain is required');
    }

    const captainId = captain._id || captain;
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (safePage - 1) * safeLimit;

    const activeRide = await module.exports.getCurrentRideForCaptain({ captain: captainId });

    // Ofertas ainda em 'requested' no raio — não têm `captain` no documento até o aceite.
    let pendingOffers = [];
    try {
        pendingOffers = await module.exports.getPendingRidesForCaptain({ captain });
    } catch {
        pendingOffers = [];
    }

    const historyQuery = {
        captain: captainId,
        status: { $in: [ 'finished', 'cancelled' ] },
    };

    const [ total, rides ] = await Promise.all([
        rideModel.countDocuments(historyQuery),
        rideModel.find(historyQuery)
            .populate('user', 'fullname phone email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit),
    ]);

    return {
        activeRide: activeRide || null,
        pendingOffers,
        rides,
        page: safePage,
        limit: safeLimit,
        total,
        hasNext: (skip + safeLimit) < total,
    };
}

// Fase B da experiência de corrida ativa (2026-08-03): pull de corridas pendentes.
// O despacho por socket/push é efêmero — se o motorista perdeu o 'new-ride' (app
// fechado, push falhou, navegador reiniciado), a corrida nunca reaparecia pra ele.
// Este pull usa os MESMOS critérios do despacho (dispatchRideToCaptains): status
// 'requested' dentro da janela de expiração, mesmo vehicleType e raio de 15 km — só
// que a partir da última posição conhecida do motorista, já que aqui é ele quem busca.
const RIDE_EXPIRATION_MINUTES = 10; // mesma janela do auto-expire de getCurrentRide
const CAPTAIN_SEARCH_RADIUS_KM = 15; // mesmo raio de dispatchRideToCaptains

module.exports.getPendingRidesForCaptain = async ({ captain }) => {
    if (!captain) {
        throw new Error('Captain is required');
    }

    // Exclusão mútua: motorista com encomenda ativa não vê ofertas de corrida.
    const dispatchService = require('./dispatch.service');
    if (await dispatchService.captainHasActiveParcel(captain._id)) return [];

    // Leitura fresca de propósito: o req.captain do middleware vem de um cache de perfil
    // de 10 min, mas 'location' muda a cada ~10s via socket sem invalidar esse cache —
    // um raio calculado sobre a posição de 10 min atrás mostraria/esconderia corridas
    // erradas para um motorista em movimento.
    const captainModel = require('../models/captain.model');
    const freshCaptain = await captainModel.findById(captain._id)
        .select('location vehicle isOnline isBlocked canReceiveRides approvalStatus');
    if (!freshCaptain) return [];

    // Espelho de captainService.availabilityFilter(): quem não seria candidato no
    // despacho por push também não deve ver corridas no pull. (lastSeenAt fica de fora:
    // esta chamada É contato do motorista com o servidor.)
    const isAvailable = freshCaptain.isOnline === true
        && freshCaptain.isBlocked !== true
        && freshCaptain.canReceiveRides !== false
        && freshCaptain.approvalStatus === 'aprovado';
    if (!isAvailable) return [];

    const vehicleType = freshCaptain.vehicle?.vehicleType;
    if (!vehicleType) return [];
    if (!(await dispatchService.isVehicleCategoryAllowed(vehicleType, 'ride'))) return [];

    const position = freshCaptain.location;
    if (!position || position.ltd == null || position.lng == null) return [];

    const cutoff = new Date(Date.now() - RIDE_EXPIRATION_MINUTES * 60 * 1000);
    const candidates = await rideModel.find({
        status: 'requested',
        // Presencial nunca fica em requested, mas o filtro evita vazamento futuro.
        source: { $ne: 'driver_initiated' },
        vehicleType,
        // SCH-C1: agendada ativada → activatedAt; imediata (activatedAt null) → createdAt.
        $or: [
            { activatedAt: { $gte: cutoff } },
            { activatedAt: null, createdAt: { $gte: cutoff } },
        ],
        // pickupCoordinates é persistido no despacho; sem ele não dá pra aplicar o raio.
        'pickupCoordinates.lat': { $exists: true }
    }).populate('user', 'fullname').sort({ createdAt: -1 }).limit(20);

    return candidates.filter(ride => {
        const pickup = ride.pickupCoordinates;
        if (!pickup || pickup.lat == null || pickup.lng == null) return false;
        return mapService.haversineKm(position.ltd, position.lng, pickup.lat, pickup.lng) <= CAPTAIN_SEARCH_RADIUS_KM;
    }).map((ride) => {
        const obj = ride.toObject();
        obj.user = toOfferPassengerPreview(ride.user);
        // Auditoria PWA (2026-08-07, P1): mesma âncora do despacho por socket/FCM
        // (dispatchRideToCaptains) — sem isto, uma oferta recuperada por este pull
        // (reconexão, troca de aba) reabria o popup sem contador sincronizado.
        obj.offerExpiresAt = computeOfferExpiresAt(obj);
        return obj;
    });
}

// Auditoria de UX do motorista (2026-08-02): o botão "Cancelar" do ConfirmRidePopUp só
// fechava os painéis no frontend — a corrida continuava atribuída a esse motorista no
// banco (e, com o índice único de corrida ativa por motorista, ele ficava impedido de
// aceitar qualquer outra corrida). Diferente de cancelRide (passageiro), aqui a corrida
// NÃO termina: volta para 'requested' sem motorista nem OTP, pra reentrar no despacho.
// Sem taxa de cancelamento — desistir é responsabilidade do motorista, não do passageiro.
// Implementação do sistema de cancelamento (2026-08-04): estágios em que o passageiro
// já teria o motorista literalmente esperando/procurando por ele — cancelar sem dizer
// por quê deixa o passageiro sem nenhuma explicação de por que "sumiu" um motorista que
// já estava a caminho ou no local.
const CAPTAIN_CANCEL_REQUIRES_REASON = ['arrived', 'waiting_passenger'];

module.exports.cancelRideByCaptain = async ({ rideId, captain, reason }) => {
    if (!rideId || !captain) {
        throw new Error('Ride id and captain are required');
    }

    const ride = await rideModel.findOne({ _id: rideId, captain });
    if (!ride) {
        throw new Error('Ride not found');
    }

    // Presencial: não há pool de despacho — cancelamento total (não requeue).
    // Também permite cancelar em 'started' antes da conclusão (engano do motorista).
    if (ride.source === 'driver_initiated') {
        const presentialOrigins = [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ];
        if (!presentialOrigins.includes(ride.status)) {
            throw new Error('Ride cannot be cancelled at this stage');
        }
        const cancelled = await rideModel.findOneAndUpdate(
            { _id: rideId, captain, status: { $in: presentialOrigins }, source: 'driver_initiated' },
            {
                $set: {
                    status: 'cancelled',
                    cancelledBy: 'captain',
                    cancellationReason: reason?.trim() || 'Cancelamento de corrida presencial',
                    cancelledAt: new Date(),
                },
            },
            { new: true }
        );
        if (!cancelled) {
            throw new Error('Ride cannot be cancelled at this stage');
        }
        const dispatchService = require('./dispatch.service');
        await dispatchService.releaseCaptainBusyLock(captain._id || captain);
        return rideModel.findById(cancelled._id).populate('user');
    }

    if (!VALID_ORIGINS_BY_TARGET.requested.includes(ride.status)) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    if (CAPTAIN_CANCEL_REQUIRES_REASON.includes(ride.status) && !reason?.trim()) {
        throw new Error('Cancellation reason is required at this stage');
    }

    const updated = await transitionRide(
        rideId,
        'requested',
        { captain },
        {},
        { captain: 1, otp: 1 },
        { captainCancellations: { captain, reason: reason?.trim() || undefined, atStatus: ride.status, cancelledAt: new Date() } }
    );
    if (!updated) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    const dispatchService = require('./dispatch.service');
    await dispatchService.releaseCaptainBusyLock(captain._id);

    // Implementação do sistema de cancelamento (2026-08-04): quem chama precisa do
    // socketId do passageiro pra avisar em tempo real (sendMessageToSocketId, não a
    // sala ride_<id> — essa sala só tem os motoristas candidatos do despacho original,
    // nunca o passageiro; usar sendMessageToRoom aqui seria um evento que não chega em
    // ninguém). transitionRide não populate por padrão (é usado em contextos que não
    // precisam disso), então busca de novo — mesmo padrão de acceptRideAtomic/startRide.
    return rideModel.findById(updated._id).populate('user');
}

// Auditoria de concorrência do painel administrativo (2026-08-02, Bloco E): antes,
// admin.service.js fazia `ride.captain = null; ride.status = 'requested'; ride.save()`
// direto — sem passar pela máquina de estados, aceitava reatribuir uma corrida em
// `started` (com o passageiro dentro do carro) e não redespachava pra ninguém, deixando
// a corrida travada em `requested` pra sempre. Reaproveita a mesma transição de
// cancelRideByCaptain (volta pra 'requested', limpa captain/otp), mas sem o filtro de
// dono — o admin pode forçar a reatribuição de qualquer corrida, não só a sua própria.
// VALID_ORIGINS_BY_TARGET.requested não inclui 'started', então essa transição sozinha
// já barra a reatribuição de uma corrida em andamento.
module.exports.reassignRideByAdmin = async (rideId) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findById(rideId);
    if (!ride) {
        throw new Error('Ride not found');
    }
    // Presencial nunca entra no pool — reatribuir seria despachar uma corrida sem
    // solicitação de passageiro (auditoria presencial, admin reassign).
    if (ride.source === 'driver_initiated') {
        throw new Error('Corrida presencial não pode ser reatribuída ao despacho');
    }
    if (!VALID_ORIGINS_BY_TARGET.requested.includes(ride.status)) {
        throw new Error('Ride cannot be reassigned at this stage');
    }
    const previousCaptain = ride.captain;

    const updated = await transitionRide(
        rideId,
        'requested',
        {},
        {},
        { captain: 1, otp: 1 }
    );
    if (!updated) {
        throw new Error('Ride cannot be reassigned at this stage');
    }

    if (previousCaptain) {
        const dispatchService = require('./dispatch.service');
        await dispatchService.releaseCaptainBusyLock(previousCaptain);
    }

    return { ride: updated, previousCaptain };
};

module.exports.cancelRide = async ({ rideId, user, reason }) => {
    if (!rideId || !user) {
        throw new Error('Ride id and user are required');
    }

    // Pré-checagem só pra mensagem de erro e pra decidir a taxa de cancelamento a partir
    // do status atual — a garantia real de concorrência é o findOneAndUpdate atômico
    // abaixo (P2.1 da auditoria: sem isso, um `cancel` e um `start`/`confirm` simultâneos
    // podiam ambos passar pela checagem em memória e produzir um estado impossível).
    const ride = await rideModel.findOne({
        _id: rideId,
        user
    });

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (!VALID_ORIGINS_BY_TARGET.cancelled.includes(ride.status)) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    // Taxa de cancelamento: só se aplica quando já existe um motorista comprometido
    // com a corrida (aceitou e está a caminho/esperando) — cancelar antes de qualquer
    // motorista aceitar não gera taxa. Valor vem do pricingSnapshot (contrato),
    // não da config live do painel.
    const capturedByDriver = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'].includes(ride.status);
    let cancellationFeeCharged = 0;
    if (capturedByDriver && ride.captain) {
        const tariffSetting = await resolveTariffSetting(ride);
        cancellationFeeCharged = tariffSetting?.cancellationFee || 0;
    }

    const updated = await transitionRide(rideId, 'cancelled', { user }, {
        cancellationFeeCharged,
        cancelledBy: 'passenger',
        cancellationReason: reason || undefined,
        cancelledAt: new Date(),
    });
    if (!updated) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    if (updated.captain) {
        const captainService = require('./captain.service');
        captainService.recalculateCancellationStats(updated.captain).catch(console.error);
        const dispatchService = require('./dispatch.service');
        await dispatchService.releaseCaptainBusyLock(updated.captain);
    }

    return updated;
}

module.exports.submitReview = async ({ rideId, user, rating, comment, issueCategory }) => {
    if (!rideId || !user || !rating) {
        throw new Error('Ride id, user and rating are required');
    }

    const ride = await rideModel.findOne({ _id: rideId, user });
    if (!ride) {
        throw new Error('Ride not found');
    }
    if (ride.status !== 'finished') {
        throw new Error('Only finished rides can be reviewed');
    }
    if (!ride.captain) {
        throw new Error('Ride has no captain to review');
    }

    const reviewModel = require('../models/review.model');
    const existing = await reviewModel.findOne({
        type: 'passenger_to_driver',
        user,
        $or: [
            { subjectType: 'ride', subjectId: rideId },
            { ride: rideId },
        ],
    });
    if (existing) {
        throw new Error('Ride already reviewed');
    }

    const review = await reviewModel.create({
        subjectType: 'ride',
        subjectId: rideId,
        ride: rideId,
        user,
        captain: ride.captain,
        rating,
        comment,
        issueCategory: issueCategory || 'none',
        type: 'passenger_to_driver'
    });

    const captainService = require('./captain.service');
    await captainService.recalculateRating(ride.captain);

    return review;
}

// Espelha submitReview (acima), na direção motorista → passageiro. Auditoria de UX do
// motorista (2026-08-02, Etapa 7, relatório: "Avaliação... Não existe. O motorista
// nunca avalia o passageiro, embora reviewApi.js exista no projeto") — o schema de
// review já tinha o tipo 'driver_to_passenger' pronto, só nada no backend o usava.
module.exports.submitCaptainReview = async ({ rideId, captain, rating, comment }) => {
    if (!rideId || !captain || !rating) {
        throw new Error('Ride id, captain and rating are required');
    }

    const ride = await rideModel.findOne({ _id: rideId, captain });
    if (!ride) {
        throw new Error('Ride not found');
    }
    if (ride.status !== 'finished') {
        throw new Error('Only finished rides can be reviewed');
    }
    if (!ride.user) {
        throw new Error('Ride has no linked passenger to review');
    }

    const reviewModel = require('../models/review.model');
    const existing = await reviewModel.findOne({
        type: 'driver_to_passenger',
        captain,
        $or: [
            { subjectType: 'ride', subjectId: rideId },
            { ride: rideId },
        ],
    });
    if (existing) {
        throw new Error('Ride already reviewed');
    }

    const review = await reviewModel.create({
        subjectType: 'ride',
        subjectId: rideId,
        ride: rideId,
        user: ride.user,
        captain,
        rating,
        comment,
        type: 'driver_to_passenger'
    });

    const userService = require('./user.service');
    await userService.recalculateRating(ride.user);

    return review;
}

