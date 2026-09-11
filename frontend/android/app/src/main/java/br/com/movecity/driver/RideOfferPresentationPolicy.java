package br.com.movecity.driver;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Regras puras, compartilhadas por push, socket, notificação e tela nativa. */
public final class RideOfferPresentationPolicy {
    public static final long HIGHLIGHT_MS = 45_000L;

    private RideOfferPresentationPolicy() {}

    public static boolean mayOpenActivity(boolean foreground, boolean overlayGranted) {
        return foreground || overlayGranted;
    }

    public static long deadline(String raw, long now) {
        // DTOs antigos não enviavam o prazo; nunca prolongar um prazo presente.
        if (raw == null || raw.trim().isEmpty()) return now + HIGHLIGHT_MS;
        String value = raw.trim();
        try {
            return Math.min(Long.parseLong(value), now + HIGHLIGHT_MS);
        } catch (NumberFormatException ignored) {}
        for (String pattern : new String[]{
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX"
        }) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
            format.setLenient(false);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            ParsePosition position = new ParsePosition(0);
            Date date = format.parse(value, position);
            if (date != null && position.getIndex() == value.length()) {
                return Math.min(date.getTime(), now + HIGHLIGHT_MS);
            }
        }
        return now; // Prazo inválido: não abrir uma oferta potencialmente vencida.
    }

    public static long remaining(long deadline, long now) {
        return deadline <= now ? 0 : Math.min(HIGHLIGHT_MS, deadline - now);
    }
}
