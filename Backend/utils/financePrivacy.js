/**
 * Privacidade financeira do motorista:
 * - Pode ver o valor que o passageiro deve pagar (fare / finalPrice).
 * - Não recebe comissão, % nem breakdown que detalhe a taxa da plataforma.
 * - `driverAmount` (líquido) fica disponível para ganhos/carteira.
 */

function toPlain(doc) {
    if (!doc) return null;
    if (typeof doc.toObject === 'function') {
        return doc.toObject({ virtuals: true });
    }
    if (typeof doc.toJSON === 'function') {
        return doc.toJSON();
    }
    return { ...doc };
}

/** Valor líquido do motorista (bruto − comissão). */
function computeDriverAmount(doc = {}) {
    const gross = Number(doc.finalPrice ?? doc.fare ?? 0);
    const commission = Number(doc.commissionAmount ?? 0);
    const safeGross = Number.isFinite(gross) ? gross : 0;
    const safeCommission = Number.isFinite(commission) ? commission : 0;
    return Math.max(0, Math.round((safeGross - safeCommission) * 100) / 100);
}

const COMMISSION_KEYS = [
    'commissionAmount',
    'commissionPercent',
    'fareBreakdown',
    'pricingSnapshot',
];

/**
 * Remove campos de comissão/split. Mantém fare/finalPrice (valor do passageiro)
 * e adiciona driverAmount (líquido) para telas de ganhos.
 */
function sanitizeCaptainFinance(doc) {
    if (!doc) return doc;
    const raw = toPlain(doc);
    const driverAmount = computeDriverAmount(raw);

    for (const key of COMMISSION_KEYS) {
        delete raw[key];
    }

    if (raw.pricing && typeof raw.pricing === 'object') {
        delete raw.pricing.commissionPercent;
        delete raw.pricing.commissionAmount;
    }

    raw.driverAmount = driverAmount;
    return raw;
}

/**
 * Taxas que o passageiro paga, sem comissão. Serve para o app do motorista
 * calcular um valor cobrável offline (zona rural) com o GPS guardado no celular.
 */
function toPassengerFareRates(snapshot) {
    const pricing = snapshot?.category?.pricing;
    if (!pricing || typeof pricing !== 'object') return undefined;

    const wait = pricing.surcharges?.waiting || {};
    const globals = Array.isArray(snapshot.globalTariffs) ? snapshot.globalTariffs : [];
    const globalTariffsTotal = globals.reduce((sum, item) => sum + (Number(item?.value) || 0), 0);

    // Adicionais noturno e de chuva também precisam viajar: sem eles o app calculava
    // um valor menor do que a finalização registraria, o motorista cobrava esse valor
    // em dinheiro e ainda pagava comissão sobre a diferença que nunca recebeu.
    const night = pricing.surcharges?.night || {};
    const rain = pricing.surcharges?.rain || {};

    return {
        baseFare: Number(pricing.baseFare) || 0,
        perKm: Number(pricing.perKm) || 0,
        perMinute: Number(pricing.perMinute) || 0,
        minimumFare: Number(pricing.minimumFare) || 0,
        minDistanceIncludedKm: Number(pricing.minDistanceIncluded) || 0,
        minTimeIncludedMin: Number(pricing.minTimeIncluded) || 0,
        roundingRule: pricing.roundingRule || 'none',
        waitingActive: wait.active !== false,
        waitingFreeMinutes: Number(wait.freeMinutes) || 0,
        waitingPerMinute: Number(wait.valuePerMinute) || 0,
        globalTariffsTotal,
        // 'multiplier' multiplica o subtotal (1.2 = +20%); 'fixed' soma direto. Mesma
        // semântica de pricingEngine.service.js — o cálculo offline reimplementa essa
        // regra, então precisa do tipo, não só do valor.
        nightActive: night.active === true,
        nightType: night.type === 'fixed' ? 'fixed' : 'multiplier',
        nightValue: Number(night.value) || 0,
        nightStartTime: night.startTime || '22:00',
        nightEndTime: night.endTime || '06:00',
        rainActive: rain.active === true,
        rainType: rain.type === 'fixed' ? 'fixed' : 'percent',
        rainValue: Number(rain.value) || 0,
    };
}

function sanitizeCaptainFinanceList(docs) {
    if (!Array.isArray(docs)) return docs;
    return docs.map((d) => sanitizeCaptainFinance(d));
}

/** Earnings breakdown sem gross/commission por corrida (só líquido). */
function sanitizeEarningsBreakdown(breakdown) {
    if (!breakdown) return breakdown;
    return {
        range: breakdown.range,
        totalEarnings: breakdown.totalEarnings,
        totalRides: breakdown.totalRides,
        rides: (breakdown.rides || []).map((r) => ({
            rideId: r.rideId,
            date: r.date,
            pickup: r.pickup,
            destination: r.destination,
            driverAmount: r.netEarnings,
            netEarnings: r.netEarnings,
        })),
    };
}

/** Wallet: esconde acumulado de comissão paga à plataforma. */
function sanitizeCaptainWallet(wallet) {
    if (!wallet) return wallet;
    const raw = toPlain(wallet);
    delete raw.totalCommissionPaid;
    return raw;
}

/**
 * Extrato: não lista type=commission. Para ride_payment/parcel_payment em cash/pix
 * o amount no ledger é bruto — reescreve para líquido usando a comissão irmã
 * presente no mesmo lote (ou map opcional).
 * @param {Array} transactions
 * @param {{ commissionByRide?: Map|Object, commissionByParcel?: Map|Object }} [hints]
 */
function sanitizeCaptainTransactions(transactions, hints = {}) {
    if (!Array.isArray(transactions)) return transactions;
    const plain = transactions.map((tx) => toPlain(tx)).filter(Boolean);

    const commissionByRide = new Map(
        hints.commissionByRide instanceof Map
            ? hints.commissionByRide
            : Object.entries(hints.commissionByRide || {})
    );
    const commissionByParcel = new Map(
        hints.commissionByParcel instanceof Map
            ? hints.commissionByParcel
            : Object.entries(hints.commissionByParcel || {})
    );

    for (const t of plain) {
        if (t.type !== 'commission') continue;
        if (t.rideId != null) {
            commissionByRide.set(String(t.rideId), Number(t.amount) || 0);
        }
        if (t.parcelId != null) {
            commissionByParcel.set(String(t.parcelId), Number(t.amount) || 0);
        }
    }

    return plain
        .filter((t) => t.type !== 'commission')
        .map((raw) => {
            const copy = { ...raw };
            if (typeof copy.description === 'string') {
                copy.description = copy.description
                    .replace(/\(\d+(?:[.,]\d+)?%\)/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            // Cartão/carteira já gravam líquido; cash/pix gravam bruto + lançamento commission.
            if (
                (copy.type === 'ride_payment' || copy.type === 'parcel_payment') &&
                !['card', 'wallet'].includes(copy.paymentMethod) &&
                Number.isFinite(Number(copy.amount))
            ) {
                let commission = 0;
                if (copy.rideId != null) {
                    commission = commissionByRide.get(String(copy.rideId)) || 0;
                }
                if (!commission && copy.parcelId != null) {
                    commission = commissionByParcel.get(String(copy.parcelId)) || 0;
                }
                if (commission > 0) {
                    copy.amount = Math.max(
                        0,
                        Math.round((Number(copy.amount) - commission) * 100) / 100
                    );
                }
            }
            return copy;
        });
}

module.exports = {
    computeDriverAmount,
    sanitizeCaptainFinance,
    sanitizeCaptainFinanceList,
    sanitizeEarningsBreakdown,
    sanitizeCaptainWallet,
    sanitizeCaptainTransactions,
    toPassengerFareRates,
    toPlain,
};
