package br.com.movecity.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.util.concurrent.Executors;

/**
 * Ações da notificação que NÃO abrem Activity (compatível com Android 12+).
 * Aceitar sai daqui: usa RideOfferAcceptActivity via PendingIntent.getActivity.
 */
public class RideOfferActionReceiver extends BroadcastReceiver {
    /** @deprecated Aceitar usa RideOfferAcceptActivity; mantido só por Intent legados. */
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

        if (ACTION_OPEN.equals(action)) {
            RideOfferFlowLog.i("OFFER_OPEN_CLICKED", "offerId=" + offerId);
            RideOfferNotifier.openOfferActivity(context, intent);
            return;
        }

        // Aceitar não passa mais por BroadcastReceiver (notification trampoline Android 12+).
        // Notificações novas usam PendingIntent.getActivity → RideOfferAcceptActivity.
        if (ACTION_ACCEPT.equals(action)) {
            RideOfferFlowLog.w("OFFER_ACCEPT_LEGACY_RECEIVER",
                "ignorado — use RideOfferAcceptActivity; offerId=" + offerId);
            Toast.makeText(context, "Abra a oferta novamente ou atualize o app", Toast.LENGTH_LONG).show();
            return;
        }

        if (!ACTION_REJECT.equals(action)) return;

        RideOfferFlowLog.i("OFFER_REJECT_CLICKED", "kind=" + kind + " offerId=" + offerId);
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
                Toast.makeText(context, "Oferta recusada", Toast.LENGTH_SHORT).show();
                RideOfferNotifier.cancelNotification(context, offerFinal);
                RideOfferNotifier.cancelLaunchAlarm(context, offerFinal);
                pending.finish();
            });
        });
    }
}
