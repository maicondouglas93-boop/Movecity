package br.com.movecity.driver;

import android.app.Activity;
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
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.List;
import java.util.Map;

/**
 * Dispara a RideOfferActivity (tela nativa verde).
 *
 * UI da oferta = só a Activity. Aceitar/Recusar NÃO ficam na bandeja.
 *
 * Em background o Android bloqueia startActivity (BAL). Por isso ainda postamos
 * uma notificação mínima com fullScreenIntent — é o “veículo” do sistema para
 * abrir a Activity. Sem botões Aceitar/Recusar; a Activity cancela essa
 * notificação no onCreate.
 */
public final class RideOfferNotifier {
    public static final String CHANNEL_ID = "ride_offers_v3";
    private static final int LEGACY_NOTIFICATION_ID = 22001;
    private static final String TAG = "RideOfferNotifier";

    private RideOfferNotifier() {}

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
        Activity resumed = CurrentActivityHolder.get();
        if (resumed != null && !resumed.isFinishing()) return true;

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
                Log.w(TAG, "USE_FULL_SCREEN_INTENT negada — Activity via holder/alarme");
            }
        }

        boolean isParcel = "NEW_PARCEL".equals(data.get("type"));
        String kind = isParcel ? RideOfferAcceptHelper.KIND_PARCEL : RideOfferAcceptHelper.KIND_RIDE;
        String offerId = firstNonEmpty(
            isParcel ? data.get("parcelId") : data.get("rideId"),
            firstNonEmpty(data.get("rideId"), data.get("parcelId"))
        );
        if (offerId == null || offerId.isEmpty()) return;

        Intent fullScreen = buildOfferIntent(context, data, kind, offerId);
        boolean foreground = isAppInForeground(context);

        Log.i(TAG, "oferta → RideOfferActivity kind=" + kind
            + " offerId=" + offerId + " foreground=" + foreground);

        // Sempre tentar abrir a tela nativa (holder / startActivity / AlarmClock).
        launchOfferActivityNow(context, fullScreen, offerId);

        // Em foreground o bridge JS/Activity holder já abre a tela — não postar
        // heads-up (era a Push duplicada com Aceitar/Recusar).
        // Em background: notificação mínima + fullScreenIntent é obrigatória no
        // Android moderno para o sistema permitir a Activity (BAL).
        if (!foreground) {
            postLaunchVehicleNotification(context, fullScreen, offerId, isParcel);
        }
    }

    /**
     * Notificação só para o sistema lançar a Activity (FSI). Sem botões
     * Aceitar/Recusar e sem detalhar a oferta — a UI é a tela verde.
     * RideOfferActivity.onCreate chama cancelNotification.
     */
    private static void postLaunchVehicleNotification(
        Context context,
        Intent fullScreen,
        String offerId,
        boolean isParcel
    ) {
        int notificationId = notificationIdFor(offerId);
        PendingIntent fullScreenPi = activityPi(context, offerId.hashCode(), fullScreen);

        String title = isParcel ? "Nova encomenda" : "Nova corrida";
        // Texto genérico de propósito — não é a interface de aceite.
        String body = "Abrindo oferta…";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_movecity)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(false)
            .setFullScreenIntent(fullScreenPi, true)
            .setContentIntent(fullScreenPi)
            // Sem .addAction Aceitar/Recusar — UI exclusiva da RideOfferActivity.
            .setTimeoutAfter(15_000);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
            Log.i(TAG, "notificação-veículo FSI id=" + notificationId
                + " (sem ações; cancelada ao abrir Activity)");
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
        launchOfferActivityNow(context, fullScreen, offerId);
    }

    /**
     * 1) Activity em foreground (melhor — BAL ok)
     * 2) startActivity com retries no main looper
     * 3) AlarmClock → RideOfferLaunchReceiver (isenção BAL)
     * 4) setExactAndAllowWhileIdle backup
     */
    public static void launchOfferActivityNow(Context context, Intent fullScreen, String offerId) {
        wakeScreen(context);

        Activity resumed = CurrentActivityHolder.get();
        if (resumed != null && !resumed.isFinishing()) {
            try {
                Intent fromUi = new Intent(fullScreen);
                resumed.startActivity(fromUi);
                Log.i(TAG, "RideOfferActivity aberta via Activity em foreground");
                return;
            } catch (Exception e) {
                Log.w(TAG, "startActivity via Activity falhou", e);
            }
        }

        Handler main = new Handler(Looper.getMainLooper());
        Runnable tryStart = () -> {
            try {
                context.startActivity(fullScreen);
                Log.i(TAG, "RideOfferActivity via context.startActivity");
            } catch (Exception e) {
                Log.w(TAG, "startActivity bloqueado (BAL/OEM)", e);
            }
        };
        main.post(tryStart);
        main.postDelayed(tryStart, 200);
        main.postDelayed(tryStart, 700);

        scheduleLaunchAlarm(context, fullScreen, offerId);
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
        PendingIntent pi = launchReceiverPi(context, alarmRequestCodeFor(offerId),
            new Intent(context, RideOfferLaunchReceiver.class));
        am.cancel(pi);
        // Legado: cancelar PendingIntent de Activity antigo
        PendingIntent legacy = activityPi(
            context,
            alarmRequestCodeFor(offerId),
            new Intent(context, RideOfferActivity.class)
        );
        am.cancel(legacy);
    }

    private static void scheduleLaunchAlarm(Context context, Intent fullScreen, String offerId) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent launch = new Intent(context, RideOfferLaunchReceiver.class);
        launch.setAction(RideOfferLaunchReceiver.ACTION_LAUNCH);
        copyOfferExtras(fullScreen, launch);
        PendingIntent pi = launchReceiverPi(context, alarmRequestCodeFor(offerId), launch);

        long when = System.currentTimeMillis() + 350L;
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(when, pi), pi);
            Log.i(TAG, "AlarmClock → LaunchReceiver agendado");
        } catch (Exception e) {
            Log.e(TAG, "Falha AlarmClock", e);
        }

        // Backup se OEM limitar AlarmClock de apps de terceiros
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when + 400L, pi);
                Log.i(TAG, "setExactAndAllowWhileIdle backup agendado");
            }
        } catch (SecurityException se) {
            Log.w(TAG, "exact alarm sem permissão — só AlarmClock/FSI", se);
        } catch (Exception e) {
            Log.w(TAG, "backup exact alarm falhou", e);
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

    private static PendingIntent launchReceiverPi(Context context, int requestCode, Intent intent) {
        return broadcastPi(context, requestCode, intent);
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
            wl.acquire(4000L);
        } catch (Exception ignored) {}
    }

    private static String firstNonEmpty(String a, String b) {
        return a != null && !a.isEmpty() ? a : b;
    }
}
