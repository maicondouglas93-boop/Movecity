package br.com.movecity.driver;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

/**
 * Abre a MainActivity com deep link pós-aceite.
 * Deve ser chamado a partir de uma Activity (nunca de BroadcastReceiver de notificação).
 */
public final class RideOfferLaunchHelper {
    private RideOfferLaunchHelper() {}

    /** Destino após accept com status ainda `accepted` (pré-início). */
    public static String postAcceptDeepLink(boolean isParcel) {
        return isParcel ? "/captain-parcel" : "/captain-home";
    }

    public static void openMainAfterAccept(Context context, String deepLink) {
        RideOfferFlowLog.i("OPEN_APP_REQUESTED", "deepLink=" + deepLink);
        NativeDeepLinkStore.set(context, deepLink);
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("deepLink", deepLink);
        try {
            context.startActivity(launch);
            RideOfferFlowLog.i("OPEN_APP_SUCCESS", "deepLink=" + deepLink
                + " fromActivity=" + (context instanceof Activity));
        } catch (Exception e) {
            RideOfferFlowLog.e("OPEN_APP_ERROR", e);
        }
    }
}
