package br.com.movecity.driver;

import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.List;
import java.util.Map;

/**
 * Notificação high-priority + fullScreenIntent + AlarmClock (bypass MIUI BAL)
 * → RideOfferActivity. Ações Aceitar/Recusar na bandeja como fallback.
 * Suporta NEW_RIDE e NEW_PARCEL. ID de notificação por oferta (não sobrescreve).
 */
public final class RideOfferNotifier {
    // v3: som de ringtone no canal (canais Android não atualizam sound depois de criados).
    public static final String CHANNEL_ID = "ride_offers_v3";
    /** ID legado (pré-fila) — cancelado junto para limpar ofertas antigas. */
    private static final int LEGACY_NOTIFICATION_ID = 22001;
    private static final String TAG = "RideOfferNotifier";

    private RideOfferNotifier() {}

    /** Notification ID estável e positivo por oferta. */
    public static int notificationIdFor(String offerId) {
        if (offerId == null || offerId.isEmpty()) return LEGACY_NOTIFICATION_ID;
        return 0x71000000 | (offerId.hashCode() & 0x00FFFFFF);
    }

    public static int alarmRequestCodeFor(String offerId) {
        if (offerId == null || offerId.isEmpty()) return 22002;
        return 0x72000000 | (offerId.hashCode() & 0x00FFFFFF);
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Ofertas de corrida",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Corridas e encomendas — tela cheia");
        channel.enableVibration(true);
        channel.setBypassDnd(true);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .build();
        Uri ringtone = android.media.RingtoneManager.getDefaultUri(
            android.media.RingtoneManager.TYPE_RINGTONE
        );
        if (ringtone == null) {
            ringtone = android.provider.Settings.System.DEFAULT_NOTIFICATION_URI;
        }
        channel.setSound(ringtone, audio);
        nm.createNotificationChannel(channel);
    }

    public static boolean isAppInForeground(Context context) {
        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
        if (procs == null) return false;
        final String pkg = context.getPackageName();
        for (ActivityManager.RunningAppProcessInfo proc : procs) {
            if (proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                && proc.processName != null
                && proc.processName.equals(pkg)) {
                return true;
            }
        }
        return false;
    }

    public static void showFullScreenOffer(Context context, Map<String, String> data) {
        ensureChannel(context);
        wakeScreen(context);
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nmCheck = context.getSystemService(NotificationManager.class);
            if (nmCheck != null && !nmCheck.canUseFullScreenIntent()) {
                Log.w(TAG, "USE_FULL_SCREEN_INTENT negada — oferta fica na bandeja + AlarmClock");
            }
        }

        boolean isParcel = "NEW_PARCEL".equals(data.get("type"));
        String kind = isParcel ? RideOfferAcceptHelper.KIND_PARCEL : RideOfferAcceptHelper.KIND_RIDE;
        String offerId = firstNonEmpty(
            isParcel ? data.get("parcelId") : data.get("rideId"),
            firstNonEmpty(data.get("rideId"), data.get("parcelId"))
        );
        if (offerId == null || offerId.isEmpty()) return;

        int notificationId = notificationIdFor(offerId);
        Intent fullScreen = buildOfferIntent(context, data, kind, offerId);
        PendingIntent fullScreenPi = activityPi(context, offerId.hashCode(), fullScreen);

        Intent accept = new Intent(context, RideOfferActionReceiver.class);
        accept.setAction(RideOfferActionReceiver.ACTION_ACCEPT);
        copyOfferExtras(fullScreen, accept);
        PendingIntent acceptPi = broadcastPi(context, offerId.hashCode() + 11, accept);

        Intent reject = new Intent(context, RideOfferActionReceiver.class);
        reject.setAction(RideOfferActionReceiver.ACTION_REJECT);
        copyOfferExtras(fullScreen, reject);
        PendingIntent rejectPi = broadcastPi(context, offerId.hashCode() + 17, reject);

        String defaultTitle = isParcel ? "Nova encomenda disponível" : "Nova corrida disponível";
        String title = firstNonEmpty(data.get("title"), defaultTitle);
        String message = firstNonEmpty(data.get("message"), "Toque para ver a oferta");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_movecity)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(true)
            .setFullScreenIntent(fullScreenPi, true)
            .setContentIntent(fullScreenPi)
            .addAction(0, "Recusar", rejectPi)
            .addAction(0, "Aceitar", acceptPi)
            .setTimeoutAfter(45_000);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
            Log.i(TAG, "notificação nativa criada id=" + notificationId
                + " kind=" + kind + " offerId=" + offerId);
        }

        scheduleLaunchAlarm(context, fullScreen, offerId);
        try {
            context.startActivity(fullScreen);
        } catch (Exception e) {
            Log.w(TAG, "startActivity bloqueado (esperado no MIUI); AlarmClock/FSI cobrem", e);
        }
    }

    public static void openOfferActivity(Context context, Intent source) {
        Intent fullScreen = new Intent(context, RideOfferActivity.class);
        fullScreen.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (source != null && source.getExtras() != null) {
            fullScreen.putExtras(source.getExtras());
        }
        String offerId = source != null ? source.getStringExtra(RideOfferActivity.EXTRA_RIDE_ID) : null;
        scheduleLaunchAlarm(context, fullScreen, offerId);
        try {
            context.startActivity(fullScreen);
        } catch (Exception e) {
            Log.w(TAG, "openOfferActivity bloqueado", e);
        }
    }

    public static void cancelNotification(Context context) {
        cancelNotification(context, null);
    }

    public static void cancelNotification(Context context, String offerId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (offerId != null && !offerId.isEmpty()) {
            nm.cancel(notificationIdFor(offerId));
        }
        nm.cancel(LEGACY_NOTIFICATION_ID);
    }

    public static void cancelLaunchAlarm(Context context) {
        cancelLaunchAlarm(context, null);
    }

    public static void cancelLaunchAlarm(Context context, String offerId) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = activityPi(
            context,
            alarmRequestCodeFor(offerId),
            new Intent(context, RideOfferActivity.class)
        );
        am.cancel(pi);
    }

    private static void scheduleLaunchAlarm(Context context, Intent fullScreen, String offerId) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = activityPi(context, alarmRequestCodeFor(offerId), fullScreen);
        long when = System.currentTimeMillis() + 300L;
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(when, pi), pi);
            Log.i(TAG, "AlarmClock agendado para abrir RideOfferActivity");
        } catch (Exception e) {
            Log.e(TAG, "Falha ao agendar AlarmClock", e);
        }
    }

    private static Intent buildOfferIntent(Context context, Map<String, String> data, String kind, String offerId) {
        boolean isParcel = RideOfferAcceptHelper.KIND_PARCEL.equals(kind);
        Intent fullScreen = new Intent(context, RideOfferActivity.class);
        fullScreen.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        fullScreen.putExtra(RideOfferActivity.EXTRA_KIND, kind);
        fullScreen.putExtra(RideOfferActivity.EXTRA_RIDE_ID, offerId);
        fullScreen.putExtra(
            RideOfferActivity.EXTRA_TITLE,
            firstNonEmpty(data.get("title"), isParcel ? "Nova encomenda disponível" : "Nova corrida disponível")
        );
        fullScreen.putExtra(RideOfferActivity.EXTRA_MESSAGE, data.get("message"));
        fullScreen.putExtra(RideOfferActivity.EXTRA_FARE, data.get("fare"));
        fullScreen.putExtra(RideOfferActivity.EXTRA_PICKUP, data.get("pickup"));
        fullScreen.putExtra(RideOfferActivity.EXTRA_DESTINATION, data.get("destination"));
        String defaultDeep = isParcel
            ? "/captain-home?parcelOffer=" + offerId
            : "/captain-home?rideOffer=" + offerId;
        fullScreen.putExtra(
            RideOfferActivity.EXTRA_DEEP_LINK,
            firstNonEmpty(data.get("deepLink"), defaultDeep)
        );
        return fullScreen;
    }

    private static void copyOfferExtras(Intent from, Intent to) {
        to.putExtra(RideOfferActivity.EXTRA_KIND, from.getStringExtra(RideOfferActivity.EXTRA_KIND));
        to.putExtra(RideOfferActivity.EXTRA_RIDE_ID, from.getStringExtra(RideOfferActivity.EXTRA_RIDE_ID));
        to.putExtra(RideOfferActivity.EXTRA_TITLE, from.getStringExtra(RideOfferActivity.EXTRA_TITLE));
        to.putExtra(RideOfferActivity.EXTRA_MESSAGE, from.getStringExtra(RideOfferActivity.EXTRA_MESSAGE));
        to.putExtra(RideOfferActivity.EXTRA_FARE, from.getStringExtra(RideOfferActivity.EXTRA_FARE));
        to.putExtra(RideOfferActivity.EXTRA_PICKUP, from.getStringExtra(RideOfferActivity.EXTRA_PICKUP));
        to.putExtra(RideOfferActivity.EXTRA_DESTINATION, from.getStringExtra(RideOfferActivity.EXTRA_DESTINATION));
        to.putExtra(RideOfferActivity.EXTRA_DEEP_LINK, from.getStringExtra(RideOfferActivity.EXTRA_DEEP_LINK));
    }

    private static PendingIntent activityPi(Context context, int requestCode, Intent intent) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }

    private static PendingIntent broadcastPi(Context context, int requestCode, Intent intent) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    private static void wakeScreen(Context context) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wl = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "movecity:rideoffer"
            );
            wl.acquire(3000L);
        } catch (Exception ignored) {}
    }

    private static String firstNonEmpty(String a, String b) {
        return a != null && !a.isEmpty() ? a : b;
    }
}
