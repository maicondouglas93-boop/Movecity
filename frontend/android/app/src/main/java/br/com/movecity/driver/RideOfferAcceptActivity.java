package br.com.movecity.driver;

import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Trampolim compatível com Android 12+: a action "Aceitar" da notificação usa
 * PendingIntent.getActivity → esta Activity (não BroadcastReceiver → startActivity).
 *
 * Fluxo: HTTP accept → MainActivity + /captain-home (ConfirmRidePopUp) → finish().
 */
public class RideOfferAcceptActivity extends AppCompatActivity {
    public static final String EXTRA_KIND = RideOfferActivity.EXTRA_KIND;
    public static final String EXTRA_RIDE_ID = RideOfferActivity.EXTRA_RIDE_ID;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean started;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        TextView status = new TextView(this);
        status.setText("Aceitando…");
        status.setTextColor(Color.WHITE);
        status.setTextSize(16f);
        status.setGravity(Gravity.CENTER);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B3D2E"));
        root.addView(status, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        String kind = getIntent() != null ? getIntent().getStringExtra(EXTRA_KIND) : null;
        if (kind == null || kind.isEmpty()) kind = RideOfferAcceptHelper.KIND_RIDE;
        String offerId = getIntent() != null ? getIntent().getStringExtra(EXTRA_RIDE_ID) : null;
        boolean isParcel = RideOfferAcceptHelper.KIND_PARCEL.equals(kind);

        RideOfferFlowLog.i("OFFER_ACCEPT_CLICKED", "source=notification_action kind=" + kind
            + " offerId=" + (offerId != null ? offerId : "null"));

        if (offerId == null || offerId.isEmpty()) {
            RideOfferFlowLog.e("ACCEPT_HTTP_ERROR", "offerId vazio");
            Toast.makeText(this, "Oferta inválida", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        if (started) return;
        started = true;

        final String kindFinal = kind;
        final String offerFinal = offerId;
        status.setText(isParcel ? "Aceitando encomenda…" : "Aceitando corrida…");

        executor.execute(() -> {
            RideOfferFlowLog.i("ACCEPT_HTTP_START", "kind=" + kindFinal + " offerId=" + offerFinal);
            RideOfferAcceptHelper.Result result =
                RideOfferAcceptHelper.acceptOffer(this, kindFinal, offerFinal);
            mainHandler.post(() -> {
                if (result.ok) {
                    RideOfferFlowLog.i("ACCEPT_HTTP_SUCCESS", "kind=" + kindFinal
                        + " offerId=" + offerFinal + " status=accepted");
                    Toast.makeText(
                        this,
                        isParcel ? "Encomenda aceita" : "Corrida aceita",
                        Toast.LENGTH_SHORT
                    ).show();
                    String deepLink = RideOfferLaunchHelper.postAcceptDeepLink(isParcel);
                    RideOfferFlowLog.i("NAVIGATION_TARGET", deepLink);
                    RideOfferLaunchHelper.openMainAfterAccept(this, deepLink);
                } else {
                    RideOfferFlowLog.e("ACCEPT_HTTP_ERROR", result.message != null
                        ? result.message : "falha desconhecida");
                    Toast.makeText(
                        this,
                        result.message != null ? result.message : "Não foi possível aceitar",
                        Toast.LENGTH_LONG
                    ).show();
                }
                RideOfferNotifier.cancelNotification(this, offerFinal);
                RideOfferNotifier.cancelLaunchAlarm(this, offerFinal);
                finish();
            });
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
