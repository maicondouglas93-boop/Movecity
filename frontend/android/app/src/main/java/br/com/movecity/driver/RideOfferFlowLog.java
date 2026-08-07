package br.com.movecity.driver;

import android.util.Log;

/** Logs consistentes do fluxo Push → aceite → deep link (sem tokens/PII). */
public final class RideOfferFlowLog {
    public static final String TAG = "RideOfferFlow";

    private RideOfferFlowLog() {}

    public static void i(String event) {
        Log.i(TAG, event);
    }

    public static void i(String event, String detail) {
        if (detail == null || detail.isEmpty()) {
            Log.i(TAG, event);
        } else {
            Log.i(TAG, event + " | " + detail);
        }
    }

    public static void w(String event, String detail) {
        Log.w(TAG, event + (detail != null ? " | " + detail : ""));
    }

    public static void e(String event, Throwable t) {
        Log.e(TAG, event, t);
    }

    public static void e(String event, String detail) {
        Log.e(TAG, event + (detail != null ? " | " + detail : ""));
    }
}
