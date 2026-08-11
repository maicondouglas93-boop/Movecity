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
    toPlain,
};
