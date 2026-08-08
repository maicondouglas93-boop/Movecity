// Prazo de DESTAQUE de uma oferta de corrida/encomenda (popup/notificação
// insistindo com o motorista) — não confundir com o auto-cancelamento real de
// 10 min já existente (RIDE_EXPIRATION_MINUTES em ride.service.js,
// PARCEL_EXPIRATION_MINUTES em parcel.service.js): depois deste prazo, o
// popup/notificação para de insistir e o contador zera, mas a oferta pode
// continuar disponível (card "Corrida disponível"/"Corrida disponível") até o
// prazo real do backend. Mesmo valor já usado hoje pelo Android nativo
// (RideOfferNotifier.postRichOfferNotification -> setTimeoutAfter).
const OFFER_HIGHLIGHT_TTL_MS = 45_000;

// Âncora única: corrida/encomenda agendada usa activatedAt (quando saiu de
// scheduled -> requested/awaiting_provider); imediata usa createdAt. Mesmo
// critério já usado em getPendingRidesForCaptain/findPendingForCaptain.
function computeOfferExpiresAt(doc) {
    if (!doc) return null;
    const anchor = doc.activatedAt || doc.createdAt;
    if (!anchor) return null;
    return new Date(new Date(anchor).getTime() + OFFER_HIGHLIGHT_TTL_MS);
}

module.exports = { OFFER_HIGHLIGHT_TTL_MS, computeOfferExpiresAt };
