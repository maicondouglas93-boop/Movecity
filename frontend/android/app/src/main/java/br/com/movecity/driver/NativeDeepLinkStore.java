package br.com.movecity.driver;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Deep link pendente (push tap / pós-aceite) consumido pelo JS Capacitor.
 */
public final class NativeDeepLinkStore {
    private static final String PREFS = "MoveCityNative";
    private static final String KEY = "movecity_pending_deeplink";

    private NativeDeepLinkStore() {}

    public static void set(Context context, String deepLink) {
        if (deepLink == null || deepLink.isEmpty()) return;
        RideOfferFlowLog.i("DEEP_LINK_RECEIVED", deepLink);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, deepLink)
            .apply();
    }

    /** Lê e limpa. */
    public static String consume(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(KEY, null);
        if (value != null) {
            prefs.edit().remove(KEY).apply();
            RideOfferFlowLog.i("DEEP_LINK_CONSUMED", value);
        }
        return value;
    }

    public static void fromIntentExtras(Context context, android.content.Intent intent) {
        if (intent == null) return;
        String deepLink = intent.getStringExtra("deepLink");
        if (deepLink == null || deepLink.isEmpty()) {
            deepLink = intent.getStringExtra(RideOfferActivity.EXTRA_DEEP_LINK);
        }
        if (deepLink != null && !deepLink.isEmpty()) {
            set(context, deepLink);
        }
    }
}
