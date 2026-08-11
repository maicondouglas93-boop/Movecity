package br.com.movecity.driver;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Oferta full-screen (corrida ou encomenda) sobre o lock screen.
 * Aceitar → API nativa. Recusar → só fecha (fica em pending no app).
 */
public class RideOfferActivity extends AppCompatActivity {
    public static final String EXTRA_KIND = "offerKind";
    public static final String EXTRA_RIDE_ID = "rideId";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_MESSAGE = "message";
    public static final String EXTRA_FARE = "fare";
    public static final String EXTRA_PICKUP = "pickup";
    public static final String EXTRA_DESTINATION = "destination";
    public static final String EXTRA_VEHICLE_TYPE = "vehicleType";
    public static final String EXTRA_DEEP_LINK = "deepLink";

    private static final long AUTO_DISMISS_MS = 45_000L;
    private static final Pattern COORDS_SUFFIX = Pattern.compile(
        "\\s*\\(-?\\d+(?:\\.\\d+)?\\s*,\\s*-?\\d+(?:\\.\\d+)?\\)\\s*$"
    );

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String offerId;
    private String kind;
    private boolean busy = false;
    private MediaPlayer ringtonePlayer;
    private Vibrator vibrator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setShowWhenLocked(true);
        setTurnScreenOn(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        setContentView(R.layout.activity_ride_offer);
        startAlertFeedback();

        Intent intent = getIntent();
        kind = intent.getStringExtra(EXTRA_KIND);
        if (kind == null || kind.isEmpty()) kind = RideOfferAcceptHelper.KIND_RIDE;
        offerId = intent.getStringExtra(EXTRA_RIDE_ID);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String fare = intent.getStringExtra(EXTRA_FARE);
        String pickup = intent.getStringExtra(EXTRA_PICKUP);
        String destination = intent.getStringExtra(EXTRA_DESTINATION);
        String vehicleType = intent.getStringExtra(EXTRA_VEHICLE_TYPE);
        String message = intent.getStringExtra(EXTRA_MESSAGE);
        boolean isParcel = RideOfferAcceptHelper.KIND_PARCEL.equals(kind);

        TextView badgeView = findViewById(R.id.offerBadge);
        TextView titleView = findViewById(R.id.offerTitle);
        TextView fareView = findViewById(R.id.offerFare);
        TextView pickupView = findViewById(R.id.offerPickup);
        TextView destView = findViewById(R.id.offerDestination);
        TextView metaView = findViewById(R.id.offerMeta);
        TextView statusView = findViewById(R.id.offerStatus);
        Button btnAccept = findViewById(R.id.btnAccept);
        Button btnReject = findViewById(R.id.btnReject);

        btnAccept.setBackgroundResource(R.drawable.bg_btn_accept);
        btnReject.setBackgroundResource(R.drawable.bg_btn_reject);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            btnAccept.setBackgroundTintList(null);
            btnReject.setBackgroundTintList(null);
        }

        badgeView.setText(isParcel ? "Nova encomenda" : rideTypeLabel(vehicleType));
        fareView.setText(formatFare(fare, title));
        pickupView.setText(shortAddress(pickup));
        destView.setText(shortAddress(destination));

        String meta = buildMeta(message, title);
        if (meta.isEmpty()) {
            metaView.setVisibility(View.GONE);
        } else {
            metaView.setText(meta);
        }

        // Título bruto só se não tiver fare legível (fallback).
        if (fareView.getText().toString().equals("—") && title != null && !title.isEmpty()) {
            titleView.setVisibility(View.VISIBLE);
            titleView.setText(title);
        }

        btnReject.setOnClickListener(v -> {
            if (busy) return;
            busy = true;
            stopAlertFeedback();
            btnAccept.setEnabled(false);
            btnReject.setEnabled(false);
            statusView.setVisibility(View.VISIBLE);
            statusView.setText("Recusando…");
            final String rejectKind = kind;
            final String rejectId = offerId;
            executor.execute(() -> {
                if (rejectId != null && !rejectId.isEmpty()) {
                    RideOfferAcceptHelper.declineOffer(this, rejectKind, rejectId);
                }
                mainHandler.post(() -> {
                    RideOfferNotifier.cancelNotification(this, rejectId);
                    RideOfferNotifier.cancelLaunchAlarm(this, rejectId);
                    finish();
                });
            });
        });

        btnAccept.setOnClickListener(v -> {
            if (busy) return;
            if (offerId == null || offerId.isEmpty()) {
                Toast.makeText(this, "Oferta inválida", Toast.LENGTH_SHORT).show();
                finish();
                return;
            }
            busy = true;
            stopAlertFeedback();
            btnAccept.setEnabled(false);
            btnReject.setEnabled(false);
            statusView.setVisibility(View.VISIBLE);
            statusView.setText(isParcel ? "Aceitando encomenda…" : "Aceitando corrida…");
            RideOfferFlowLog.i("OFFER_ACCEPT_CLICKED", "source=green_screen kind=" + kind
                + " offerId=" + offerId);

            executor.execute(() -> {
                RideOfferFlowLog.i("ACCEPT_HTTP_START", "kind=" + kind + " offerId=" + offerId);
                RideOfferAcceptHelper.Result result = RideOfferAcceptHelper.acceptOffer(this, kind, offerId);
                mainHandler.post(() -> {
                    if (result.ok) {
                        RideOfferFlowLog.i("ACCEPT_HTTP_SUCCESS", "kind=" + kind
                            + " offerId=" + offerId + " status=accepted");
                        statusView.setText(isParcel ? "Encomenda aceita!" : "Corrida aceita!");
                        Toast.makeText(this, statusView.getText(), Toast.LENGTH_SHORT).show();
                        String deepLink = RideOfferLaunchHelper.postAcceptDeepLink(isParcel);
                        RideOfferFlowLog.i("NAVIGATION_TARGET", deepLink);
                        RideOfferLaunchHelper.openMainAfterAccept(this, deepLink);
                        finish();
                    } else {
                        RideOfferFlowLog.e("ACCEPT_HTTP_ERROR",
                            result.message != null ? result.message : "falha");
                        busy = false;
                        btnAccept.setEnabled(true);
                        btnReject.setEnabled(true);
                        statusView.setText(result.message != null ? result.message : "Não foi possível aceitar");
                        Toast.makeText(this, statusView.getText(), Toast.LENGTH_LONG).show();
                    }
                });
            });
        });

        mainHandler.postDelayed(() -> {
            if (!isFinishing()) {
                stopAlertFeedback();
                finish();
            }
        }, AUTO_DISMISS_MS);

        RideOfferNotifier.cancelNotification(this, offerId);
        RideOfferNotifier.cancelLaunchAlarm(this, offerId);
    }

    private static String rideTypeLabel(String vehicleType) {
        if ("moto".equalsIgnoreCase(vehicleType) || "motorcycle".equalsIgnoreCase(vehicleType)) {
            return "🏍 CORRIDA DE MOTO";
        }
        if ("car".equalsIgnoreCase(vehicleType)) return "🚗 CORRIDA DE CARRO";
        return "NOVA CORRIDA";
    }

    private void startAlertFeedback() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (uri == null) {
                uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            ringtonePlayer = new MediaPlayer();
            ringtonePlayer.setDataSource(this, uri);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                ringtonePlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            } else {
                ringtonePlayer.setAudioStreamType(android.media.AudioManager.STREAM_RING);
            }
            ringtonePlayer.setLooping(true);
            ringtonePlayer.prepare();
            ringtonePlayer.start();
        } catch (Exception e) {
            ringtonePlayer = null;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = new long[]{0, 600, 400, 600, 400, 800};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) {}
    }

    private void stopAlertFeedback() {
        try {
            if (ringtonePlayer != null) {
                if (ringtonePlayer.isPlaying()) ringtonePlayer.stop();
                ringtonePlayer.release();
            }
        } catch (Exception ignored) {}
        ringtonePlayer = null;
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Exception ignored) {}
    }

    private static String formatFare(String fare, String title) {
        if (fare != null && !fare.isEmpty()) {
            try {
                double value = Double.parseDouble(fare);
                return String.format("R$ %.2f", value).replace('.', ',');
            } catch (Exception e) {
                return fare.startsWith("R$") ? fare : ("R$ " + fare);
            }
        }
        if (title != null) {
            int idx = title.indexOf("R$");
            if (idx >= 0) return title.substring(idx).trim();
        }
        return "—";
    }

    private static String shortAddress(String address) {
        if (address == null || address.isEmpty()) return "—";
        String clean = COORDS_SUFFIX.matcher(address).replaceFirst("").trim();
        String[] parts = clean.split(",");
        if (parts.length >= 2) {
            return parts[0].trim() + ", " + parts[1].trim();
        }
        return clean;
    }

    private static String buildMeta(String message, String title) {
        if (message == null || message.isEmpty()) return "";
        String[] lines = message.split("\\n");
        List<String> keep = new ArrayList<>();
        for (String raw : lines) {
            String line = raw != null ? raw.trim() : "";
            if (line.isEmpty()) continue;
            // Evita repetir rota longa / título / valor.
            if (line.contains("→") || line.contains("->")) continue;
            if (title != null && line.equals(title.trim())) continue;
            if (line.startsWith("R$")) continue;
            keep.add(line);
        }
        return String.join("\n", keep);
    }

    @Override
    protected void onDestroy() {
        stopAlertFeedback();
        super.onDestroy();
        executor.shutdownNow();
    }
}
