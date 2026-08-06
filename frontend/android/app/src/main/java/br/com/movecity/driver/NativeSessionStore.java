package br.com.movecity.driver;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * SharedPreferences lidas pela RideOfferActivity com o app morto.
 * Escrito pelo plugin Capacitor NativeSession a partir do login JS.
 */
public final class NativeSessionStore {
    public static final String PREFS = "MoveCityNative";
    public static final String KEY_TOKEN = "movecity_captain_token";
    public static final String KEY_REFRESH = "movecity_captain_refresh";
    public static final String KEY_API_BASE = "movecity_api_base";

    private NativeSessionStore() {}

    public static void save(Context context, String token, String refreshToken, String apiBase) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (token != null) editor.putString(KEY_TOKEN, token);
        if (refreshToken != null) editor.putString(KEY_REFRESH, refreshToken);
        if (apiBase != null) editor.putString(KEY_API_BASE, apiBase);
        editor.apply();
    }

    public static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    public static String getToken(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null);
    }

    public static String getRefreshToken(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_REFRESH, null);
    }

    public static String getApiBase(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_API_BASE, null);
    }

    public static void updateTokens(Context context, String token, String refreshToken) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (token != null) editor.putString(KEY_TOKEN, token);
        if (refreshToken != null) editor.putString(KEY_REFRESH, refreshToken);
        editor.apply();
    }
}
