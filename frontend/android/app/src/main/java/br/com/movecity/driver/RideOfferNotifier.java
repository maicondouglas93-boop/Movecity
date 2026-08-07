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
 * Oferta de corrida/encomenda no Android.
 *
 * UI principal em background: notificação rica (BigText + Aceitar/Recusar).
 * Ainda tenta abrir a RideOfferActivity (tela verde) quando o sistema permitir;
 * se a Activity não subir sozinha, o motorista age pela Push.
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

        Log.i(TAG, "oferta → push rica + Activity kind=" + kind
            + " offerId=" + offerId + " foreground=" + foreground);

        // Push rica = UI confiável (Aceitar/Recusar + detalhes). Activity é best-effort.
        postRichOfferNotification(context, data, fullScreen, offerId, isParcel);
        launchOfferActivityNow(context, fullScreen, offerId);
    }

    /**
     * Notificação expandida com detalhes da corrida e ações Aceitar/Recusar.
     * É a interface principal quando a tela verde não abre sozinha em background.
     */
    private static void postRichOfferNotification(
        Context context,
        Map<String, String> data,
        Intent fullScreen,
        String offerId,
        boolean isParcel
    ) {
        int notificationId = notificationIdFor(offerId);
        PendingIntent fullScreenPi = activityPi(context, offerId.hashCode(), fullScreen);

        Intent accept = new Intent(context, RideOfferActionReceiver.class);
        accept.setAction(RideOfferActionReceiver.ACTION_ACCEPT);
        copyOfferExtras(fullScreen, accept);
        PendingIntent acceptPi = broadcastPi(context, offerId.hashCode() + 11, accept);

        Intent reject = new Intent(context, RideOfferActionReceiver.class);
        reject.setAction(RideOfferActionReceiver.ACTION_REJECT);
        copyOfferExtras(fullScreen, reject);
        PendingIntent rejectPi = broadcastPi(context, offerId.hashCode() + 17, reject);

        String title = buildOfferTitle(data, isParcel);
        String bigBody = buildOfferBigBody(data, isParcel);
        String summary = firstNonEmpty(
            firstLine(bigBody),
            isParcel ? "Nova encomenda disponível" : "Nova corrida disponível"
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_movecity)
            .setContentTitle(title)
            .setContentText(summary)
            .setStyle(new NotificationCompat.BigTextStyle()
                .setBigContentTitle(title)
                .bigText(bigBody)
                .setSummaryText(isParcel ? "Encomenda" : "Corrida"))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(true)
            .setOnlyAlertOnce(false)
            .setFullScreenIntent(fullScreenPi, true)
            .setContentIntent(fullScreenPi)
            .addAction(0, "Recusar", rejectPi)
            .addAction(0, "Aceitar", acceptPi)
            .setTimeoutAfter(45_000);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
            Log.i(TAG, "notificação rica criada id=" + notificationId
                + " kind=" + (isParcel ? "parcel" : "ride") + " offerId=" + offerId);
        }
    }

    private static String buildOfferTitle(Map<String, String> data, boolean isParcel) {
        String fromPayload = data.get("title");
        if (fromPayload != null && !fromPayload.isEmpty()) return fromPayload;
        String fare = formatFare(data.get("fare"));
        if (isParcel) {
            return fare != null ? "Nova encomenda · " + fare : "Nova encomenda disponível";
        }
        return fare != null ? "Nova corrida · " + fare : "Nova corrida disponível";
    }

    /** Corpo longo para BigTextStyle ocupar área maior na heads-up/bandeja. */
    private static String buildOfferBigBody(Map<String, String> data, boolean isParcel) {
        StringBuilder sb = new StringBuilder();
        String fare = formatFare(data.get("fare"));
        if (fare != null) {
            sb.append("Valor: ").append(fare).append('\n');
        }

        String pickup = firstNonEmpty(data.get("pickup"), null);
        String destination = firstNonEmpty(data.get("destination"), null);
        if (pickup != null) {
            sb.append(isParcel ? "Coleta: " : "Origem: ").append(pickup).append('\n');
        }
        if (destination != null) {
            sb.append(isParcel ? "Entrega: " : "Destino: ").append(destination).append('\n');
        }

        String distance = formatDistance(data);
        String duration = formatDuration(data);
        if (distance != null || duration != null) {
            String meta = joinNonEmpty(" · ", distance, duration);
            if (meta != null) sb.append(meta).append('\n');
        }

        String passenger = firstNonEmpty(
            data.get("passengerName"),
            firstNonEmpty(data.get("userName"), null)
        );
        if (passenger != null) {
            String first = passenger.trim().split("\\s+")[0];
            sb.append("Passageiro: ").append(first).append('\n');
        }

        String vehicle = firstNonEmpty(data.get("vehicleType"), null);
        if (vehicle != null) {
            sb.append("Categoria: ").append(vehicle).append('\n');
        }

        // message do backend já vem rico (rota/km/min) — acrescenta se ainda não coberto
        String message = data.get("message");
        if (message != null && !message.isEmpty() && sb.indexOf(message) < 0) {
            if (sb.length() > 0) sb.append('\n');
            sb.append(message.replace("\\n", "\n"));
        }

        if (sb.length() == 0) {
            return isParcel
                ? "Nova encomenda disponível.\nToque em Aceitar ou Recusar."
                : "Nova corrida disponível.\nToque em Aceitar ou Recusar.";
        }
        sb.append('\n').append("Use Aceitar ou Recusar abaixo.");
        return sb.toString().trim();
    }

    private static String formatFare(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            double v = Double.parseDouble(raw.replace(',', '.'));
            return String.format(java.util.Locale.GERMANY, "R$ %.2f", v);
        } catch (Exception e) {
            return raw.startsWith("R$") ? raw : "R$ " + raw;
        }
    }

    private static String formatDistance(Map<String, String> data) {
        String meters = firstNonEmpty(data.get("estimatedDistance"), data.get("distance"));
        if (meters == null) return null;
        try {
            double m = Double.parseDouble(meters);
            if (m <= 0) return null;
            return String.format(java.util.Locale.GERMANY, "%.1f km", m / 1000.0);
        } catch (Exception e) {
            return null;
        }
    }

    private static String formatDuration(Map<String, String> data) {
        String seconds = firstNonEmpty(data.get("estimatedTime"), data.get("duration"));
        if (seconds == null) return null;
        try {
            double s = Double.parseDouble(seconds);
            if (s <= 0) return null;
            int min = Math.max(1, (int) Math.round(s / 60.0));
            return min + " min";
        } catch (Exception e) {
            return null;
        }
    }

    private static String joinNonEmpty(String sep, String... parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.isEmpty()) continue;
            if (sb.length() > 0) sb.append(sep);
            sb.append(p);
        }
        return sb.length() > 0 ? sb.toString() : null;
    }

    private static String firstLine(String text) {
        if (text == null || text.isEmpty()) return null;
        int nl = text.indexOf('\n');
        return nl >= 0 ? text.substring(0, nl).trim() : text.trim();
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
