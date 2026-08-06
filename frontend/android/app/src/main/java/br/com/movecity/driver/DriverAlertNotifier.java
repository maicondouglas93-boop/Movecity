package br.com.movecity.driver;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import java.util.Map;

/**
 * Notificações secundárias em background (chat, cancelamento, pagamento…).
 * Tap → MainActivity + deepLink (NativeDeepLinkBridge).
 */
public final class DriverAlertNotifier {
    public static final String CHANNEL_ID = "driver_alerts_v1";
    private static final int BASE_ID = 23000;

    private DriverAlertNotifier() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Alertas do motorista",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Chat, pagamentos, cancelamentos e avisos");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build();
        channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, audio);
        nm.createNotificationChannel(channel);
    }

    public static void show(Context context, Map<String, String> data) {
        if (data == null) return;
        ensureChannel(context);

        String title = firstNonEmpty(data.get("title"), "MoveCity Motorista");
        String message = firstNonEmpty(data.get("message"), data.get("body"));
        if (message == null || message.isEmpty()) message = "Abra o app para ver detalhes";

        String type = data.get("type") != null ? data.get("type") : "ALERT";
        String deepLink = firstNonEmpty(data.get("deepLink"), "/captain-home");

        NativeDeepLinkStore.set(context, deepLink);

        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("deepLink", deepLink);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        int requestCode = BASE_ID + Math.abs(type.hashCode() % 1000);
        PendingIntent contentPi = PendingIntent.getActivity(context, requestCode, launch, flags);

        String category = "CHAT".equals(type)
            ? NotificationCompat.CATEGORY_MESSAGE
            : NotificationCompat.CATEGORY_STATUS;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_movecity)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(category)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(contentPi);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(requestCode, builder.build());
        }
    }

    private static String firstNonEmpty(String a, String b) {
        if (a != null && !a.isEmpty()) return a;
        return b;
    }
}
