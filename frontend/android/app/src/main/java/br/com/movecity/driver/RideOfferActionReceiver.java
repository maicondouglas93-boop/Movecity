package br.com.movecity.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.util.concurrent.Executors;

/**
 * Aceitar/Recusar direto da notificação (quando o MIUI bloqueia a Activity em background).
 */
public class RideOfferActionReceiver extends BroadcastReceiver {
    public static final String ACTION_ACCEPT = "br.com.movecity.driver.RIDE_OFFER_ACCEPT";
    public static final String ACTION_REJECT = "br.com.movecity.driver.RIDE_OFFER_REJECT";
    public static final String ACTION_OPEN = "br.com.movecity.driver.RIDE_OFFER_OPEN";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        String offerId = intent.getStringExtra(RideOfferActivity.EXTRA_RIDE_ID);
        String kind = intent.getStringExtra(RideOfferActivity.EXTRA_KIND);
        if (kind == null || kind.isEmpty()) kind = RideOfferAcceptHelper.KIND_RIDE;
        boolean isParcel = RideOfferAcceptHelper.KIND_PARCEL.equals(kind);

        if (ACTION_OPEN.equals(action)) {
            RideOfferNotifier.openOfferActivity(context, intent);
            return;
        }

        if (ACTION_REJECT.equals(action)) {
            if (offerId == null || offerId.isEmpty()) {
                RideOfferNotifier.cancelNotification(context, null);
                RideOfferNotifier.cancelLaunchAlarm(context, null);
                return;
            }
            final String kindFinal = kind;
            final String offerFinal = offerId;
            final PendingResult pending = goAsync();
            Executors.newSingleThreadExecutor().execute(() -> {
                RideOfferAcceptHelper.declineOffer(context, kindFinal, offerFinal);
                Handler main = new Handler(Looper.getMainLooper());
                main.post(() -> {
                    RideOfferNotifier.cancelNotification(context, offerFinal);
                    RideOfferNotifier.cancelLaunchAlarm(context, offerFinal);
                    pending.finish();
                });
            });
            return;
        }

        if (!ACTION_ACCEPT.equals(action)) return;
        if (offerId == null || offerId.isEmpty()) {
            RideOfferNotifier.cancelNotification(context, null);
            return;
        }

        final String kindFinal = kind;
        final String offerFinal = offerId;
        final PendingResult pending = goAsync();
        Executors.newSingleThreadExecutor().execute(() -> {
            RideOfferAcceptHelper.Result result = RideOfferAcceptHelper.acceptOffer(context, kindFinal, offerFinal);
            Handler main = new Handler(Looper.getMainLooper());
            main.post(() -> {
                if (result.ok) {
                    Toast.makeText(context, isParcel ? "Encomenda aceita" : "Corrida aceita", Toast.LENGTH_SHORT).show();
                    openMain(context, isParcel ? "/captain-parcel" : "/captain-riding");
                } else {
                    Toast.makeText(
                        context,
                        result.message != null ? result.message : "Não foi possível aceitar",
                        Toast.LENGTH_LONG
                    ).show();
                }
                RideOfferNotifier.cancelNotification(context, offerFinal);
                RideOfferNotifier.cancelLaunchAlarm(context, offerFinal);
                pending.finish();
            });
        });
    }

    private static void openMain(Context context, String deepLink) {
        NativeDeepLinkStore.set(context, deepLink);
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("deepLink", deepLink);
        try {
            context.startActivity(launch);
        } catch (Exception ignored) {}
    }
}
