package br.com.movecity.passenger;

import android.app.ActivityManager;
import android.content.Context;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Map;

/**
 * Mesmo transporte FCM do Motorista, reduzido ao domínio do Passageiro.
 * Foreground segue para o React; background data-only vira notificação Android.
 */
public class PassengerMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();

        if (isAppInForeground(this)) {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            return;
        }

        if (data != null && hasAlertPayload(data)) {
            PassengerAlertNotifier.show(this, data);
            return;
        }

        // Mantém o fallback do plugin para payloads que não têm UI nativa própria.
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        PushNotificationsPlugin.onNewToken(token);
    }

    private static boolean hasAlertPayload(Map<String, String> data) {
        return notEmpty(data.get("title"))
            || notEmpty(data.get("message"))
            || notEmpty(data.get("body"));
    }

    private static boolean notEmpty(String value) {
        return value != null && !value.isEmpty();
    }

    private static boolean isAppInForeground(Context context) {
        ActivityManager manager = (ActivityManager) context.getSystemService(
            Context.ACTIVITY_SERVICE
        );
        if (manager == null) return false;
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return false;

        String packageName = context.getPackageName();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                && packageName.equals(process.processName)) {
                return true;
            }
        }
        return false;
    }
}
