package br.com.movecity.driver;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Background:
 * - NEW_RIDE / NEW_PARCEL → full-screen
 * - demais tipos com título/corpo → bandeja + deep link
 * Foreground → Capacitor (JS/socket).
 */
public class MoveCityMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data != null ? data.get("type") : null;
        boolean foreground = RideOfferNotifier.isAppInForeground(this);

        boolean offer = "NEW_RIDE".equals(type) || "NEW_PARCEL".equals(type);
        if (offer && !foreground) {
            RideOfferNotifier.showFullScreenOffer(this, data);
            return;
        }

        if (!foreground && data != null && hasAlertPayload(data)) {
            DriverAlertNotifier.show(this, data);
            return;
        }

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
