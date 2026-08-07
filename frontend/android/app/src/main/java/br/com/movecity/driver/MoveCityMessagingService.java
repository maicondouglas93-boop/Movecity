package br.com.movecity.driver;

import android.util.Log;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * FCM = transporte (acordar/receber data message em background).
 *
 * Ofertas (NEW_RIDE / NEW_PARCEL): dispara RideOfferNotifier → RideOfferActivity
 * (tela nativa verde). A Push visual da bandeja com Aceitar/Recusar está
 * desativada em RideOfferNotifier — FCM continua necessário para o fluxo.
 *
 * Alertas com título/corpo: DriverAlertNotifier (nativa).
 * Fallback Capacitor só quando não há payload apresentável nativamente.
 */
public class MoveCityMessagingService extends FirebaseMessagingService {

    private static final String TAG = "MoveCityFCM";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data != null ? data.get("type") : null;
        boolean foreground = RideOfferNotifier.isAppInForeground(this);

        Log.i(TAG, "FCM recebido type=" + type
            + " foreground=" + foreground
            + " hasNotificationBlock=" + (remoteMessage.getNotification() != null)
            + " dataKeys=" + (data != null ? data.keySet() : "null"));

        boolean offer = "NEW_RIDE".equals(type) || "NEW_PARCEL".equals(type);
        if (offer) {
            Log.i(TAG, "processamento oferta → RideOfferNotifier (nativa)");
            RideOfferNotifier.showFullScreenOffer(this, data);
            return;
        }

        if (data != null && hasAlertPayload(data)) {
            Log.i(TAG, "processamento alerta → DriverAlertNotifier (nativa)");
            DriverAlertNotifier.show(this, data);
            return;
        }

        Log.i(TAG, "sem payload nativo apresentável → Capacitor JS");
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        PushNotificationsPlugin.onNewToken(token);
    }

    private static boolean hasAlertPayload(Map<String, String> data) {
        String title = data.get("title");
        String message = data.get("message");
        String body = data.get("body");
        return (title != null && !title.isEmpty())
            || (message != null && !message.isEmpty())
            || (body != null && !body.isEmpty());
    }
}
