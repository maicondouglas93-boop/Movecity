package br.com.movecity.driver;

/** Limites em pixels; não depende de tamanho fixo de celular nem de fonte. */
final class RideOfferModalSizing {
    private RideOfferModalSizing() {}

    static int width(int availablePx, float density) {
        int sideMargins = Math.round(32 * density);
        return Math.max(1, Math.min(availablePx - sideMargins, Math.round(440 * density)));
    }

    static int maxHeight(int availablePx, float density) {
        return Math.max(1, Math.min((int) (availablePx * 0.84f), Math.round(640 * density)));
    }
}
