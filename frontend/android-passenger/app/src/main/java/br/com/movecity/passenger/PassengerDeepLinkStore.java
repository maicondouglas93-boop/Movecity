package br.com.movecity.passenger;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Persiste somente a rota interna recebida no toque da notificação. A rota não é
 * secreta, portanto SharedPreferences é suficiente. A allowlist impede que um
 * payload do Passageiro abra telas exclusivas do Motorista ou ações de logout.
 */
public final class PassengerDeepLinkStore {
    private static final String PREFS = "MoveCityPassengerDeepLink";
    private static final String KEY = "pending_deep_link";

    private static final Set<String> ALLOWED_PATHS = new HashSet<>(Arrays.asList(
        "/home",
        "/riding",
        "/scheduled",
        "/encomenda/ativa",
        "/wallet",
        "/coupons",
        "/activity",
        "/profile",
        "/notifications"
    ));

    private PassengerDeepLinkStore() {}

    public static String normalize(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            String candidate = raw.trim();
            if (!candidate.startsWith("/")
                && !candidate.startsWith("http://")
                && !candidate.startsWith("https://")) {
                candidate = "/" + candidate;
            }

            Uri uri = Uri.parse(candidate);
            String path = uri.getPath();
            if (path == null || !ALLOWED_PATHS.contains(path)) return null;

            String query = uri.getEncodedQuery();
            return query == null || query.isEmpty() ? path : path + "?" + query;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static void set(Context context, String raw) {
        String deepLink = normalize(raw);
        if (deepLink == null) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, deepLink)
            .apply();
    }

    public static String consume(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(KEY, null);
        if (value != null) prefs.edit().remove(KEY).apply();
        return value;
    }

    public static void fromIntent(Context context, Intent intent) {
        if (intent == null) return;
        String deepLink = intent.getStringExtra("deepLink");
        if (deepLink == null || deepLink.isEmpty()) {
            deepLink = intent.getStringExtra("link");
        }
        if ((deepLink == null || deepLink.isEmpty()) && intent.getData() != null) {
            deepLink = intent.getData().toString();
        }
        set(context, deepLink);
    }
}
