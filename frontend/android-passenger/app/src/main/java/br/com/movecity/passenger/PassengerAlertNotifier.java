package br.com.movecity.passenger;

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
 * Versão adaptada do DriverAlertNotifier. Exibe apenas alertas comuns e abre o
 * WebView do Passageiro; não contém full-screen intent, oferta ou ação HTTP nativa.
 */
public final class PassengerAlertNotifier {
    public static final String CHANNEL_ID = "passenger_alerts_v1";
    private static final int BASE_ID = 31000;

    private PassengerAlertNotifier() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Alertas de corridas e encomendas",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Motorista, corrida, encomenda, chat e avisos do MoveCity");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build();
        channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, audio);
        manager.createNotificationChannel(channel);
    }

    public static void show(Context context, Map<String, String> data) {
        if (data == null) return;
        ensureChannel(context);

        String title = firstNonEmpty(data.get("title"), "MoveCity");
        String message = firstNonEmpty(data.get("message"), data.get("body"));
        if (message == null || message.isEmpty()) message = "Abra o app para ver detalhes";

        String type = firstNonEmpty(data.get("type"), "ALERT");
        String deepLink = PassengerDeepLinkStore.normalize(
            firstNonEmpty(data.get("deepLink"), data.get("link"))
        );
        if (deepLink == null) deepLink = "/home";

        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("deepLink", deepLink);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        String identity = firstNonEmpty(
            data.get("notificationId"),
            firstNonEmpty(data.get("rideId"), firstNonEmpty(data.get("parcelId"), type))
        );
        int requestCode = BASE_ID + Math.abs(identity.hashCode() % 10000);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            requestCode,
            launch,
            flags
        );

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
            .setContentIntent(contentIntent);

        NotificationManager manager = (NotificationManager) context.getSystemService(
            Context.NOTIFICATION_SERVICE
        );
        if (manager != null) manager.notify(requestCode, builder.build());
    }

    private static String firstNonEmpty(String first, String second) {
        if (first != null && !first.isEmpty()) return first;
        return second;
    }
}
