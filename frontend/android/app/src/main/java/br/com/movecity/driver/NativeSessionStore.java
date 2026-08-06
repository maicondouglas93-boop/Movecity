package br.com.movecity.driver;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/**
 * Sessão do motorista lida pela RideOfferActivity com o app morto.
 * Preferências criptografadas (AES-256); migra e apaga o store plaintext legado.
 */
public final class NativeSessionStore {
    public static final String PREFS = "MoveCityNativeSecure";
    /** Store antigo (plaintext) — só para migração one-shot. */
    private static final String LEGACY_PREFS = "MoveCityNative";
    public static final String KEY_TOKEN = "movecity_captain_token";
    public static final String KEY_REFRESH = "movecity_captain_refresh";
    public static final String KEY_API_BASE = "movecity_api_base";
    private static final String TAG = "NativeSessionStore";

    private static volatile SharedPreferences cached;

    private NativeSessionStore() {}

    private static SharedPreferences prefs(Context context) {
        SharedPreferences local = cached;
        if (local != null) return local;
        synchronized (NativeSessionStore.class) {
            if (cached != null) return cached;
            Context app = context.getApplicationContext();
            try {
                MasterKey masterKey = new MasterKey.Builder(app)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
                cached = EncryptedSharedPreferences.create(
                    app,
                    PREFS,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );
                migrateFromLegacy(app, cached);
            } catch (Exception e) {
                // Fallback controlado: melhor aceite nativo com prefs privadas do que crash.
                Log.e(TAG, "EncryptedSharedPreferences indisponível — fallback MODE_PRIVATE", e);
                cached = app.getSharedPreferences(PREFS + "_fallback", Context.MODE_PRIVATE);
                migrateFromLegacy(app, cached);
            }
            return cached;
        }
    }

    private static void migrateFromLegacy(Context app, SharedPreferences secure) {
        SharedPreferences legacy = app.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE);
        if (legacy.getAll().isEmpty()) return;
        String token = legacy.getString(KEY_TOKEN, null);
        String refresh = legacy.getString(KEY_REFRESH, null);
        String apiBase = legacy.getString(KEY_API_BASE, null);
        boolean secureEmpty = secure.getString(KEY_TOKEN, null) == null
            && secure.getString(KEY_API_BASE, null) == null;
        if (secureEmpty && (token != null || apiBase != null)) {
            SharedPreferences.Editor editor = secure.edit();
            if (token != null) editor.putString(KEY_TOKEN, token);
            if (refresh != null) editor.putString(KEY_REFRESH, refresh);
            if (apiBase != null) editor.putString(KEY_API_BASE, apiBase);
            editor.apply();
            Log.i(TAG, "Sessão migrada do SharedPreferences plaintext");
        }
        legacy.edit().clear().apply();
    }

    public static void save(Context context, String token, String refreshToken, String apiBase) {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (token != null) editor.putString(KEY_TOKEN, token);
        if (refreshToken != null) editor.putString(KEY_REFRESH, refreshToken);
        if (apiBase != null) editor.putString(KEY_API_BASE, apiBase);
        editor.apply();
        // Garante que o legado não fica com cópia.
        context.getApplicationContext()
            .getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();
    }

    public static void clear(Context context) {
        prefs(context).edit().clear().apply();
        context.getApplicationContext()
            .getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();
    }

    public static String getToken(Context context) {
        return prefs(context).getString(KEY_TOKEN, null);
    }

    public static String getRefreshToken(Context context) {
        return prefs(context).getString(KEY_REFRESH, null);
    }

    public static String getApiBase(Context context) {
        return prefs(context).getString(KEY_API_BASE, null);
    }

    public static void updateTokens(Context context, String token, String refreshToken) {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (token != null) editor.putString(KEY_TOKEN, token);
        if (refreshToken != null) editor.putString(KEY_REFRESH, refreshToken);
        editor.apply();
    }
}
