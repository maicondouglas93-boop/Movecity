package br.com.movecity.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Compatibilidade com alarmes de versões antigas. Não agendamos novos alarmes
 * para abrir ofertas nem usamos alarmes para contornar a autorização do usuário.
 */
public class RideOfferLaunchReceiver extends BroadcastReceiver {
    public static final String ACTION_LAUNCH = "br.com.movecity.driver.ACTION_LAUNCH_RIDE_OFFER";
    private static final String TAG = "RideOfferLaunch";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (!RideOfferPresentationPolicy.mayOpenActivity(
            RideOfferNotifier.isAppInForeground(context), android.provider.Settings.canDrawOverlays(context)
        )) return;
        long deadline = intent.getLongExtra(RideOfferActivity.EXTRA_EXPIRES_AT, 0);
        if (RideOfferPresentationPolicy.remaining(deadline, System.currentTimeMillis()) == 0) return;
        Log.i(TAG, "alarme/broadcast → abrindo RideOfferActivity");
        Intent fullScreen = new Intent(context, RideOfferActivity.class);
        fullScreen.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (intent.getExtras() != null) {
            fullScreen.putExtras(intent.getExtras());
        }
        try {
            context.startActivity(fullScreen);
            Log.i(TAG, "RideOfferActivity iniciada via LaunchReceiver");
        } catch (Exception e) {
            Log.e(TAG, "Falha ao abrir RideOfferActivity via receiver", e);
            // Último recurso: deixa a notificação na bandeja (contentIntent).
        }
    }
}
