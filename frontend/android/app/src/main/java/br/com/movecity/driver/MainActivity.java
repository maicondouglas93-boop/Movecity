package br.com.movecity.driver;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSessionPlugin.class);
        registerPlugin(NativeDriverPermissionsPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(NativeRideOfferPlugin.class);
        super.onCreate(savedInstanceState);
        CurrentActivityHolder.install(getApplication());
        RideOfferNotifier.ensureChannel(this);
        DriverAlertNotifier.ensureChannel(this);
        String deepLink = peekDeepLink(getIntent());
        RideOfferFlowLog.i("MAIN_ACTIVITY_ON_CREATE",
            "deepLink=" + (deepLink != null ? deepLink : "none"));
        if (deepLink != null) {
            RideOfferFlowLog.i("DEEP_LINK_RECEIVED", deepLink);
        }
        NativeDeepLinkStore.fromIntentExtras(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String deepLink = peekDeepLink(intent);
        RideOfferFlowLog.i("MAIN_ACTIVITY_ON_NEW_INTENT",
            "deepLink=" + (deepLink != null ? deepLink : "none"));
        if (deepLink != null) {
            RideOfferFlowLog.i("DEEP_LINK_RECEIVED", deepLink);
        }
        NativeDeepLinkStore.fromIntentExtras(this, intent);
    }

    private static String peekDeepLink(Intent intent) {
        if (intent == null) return null;
        String deepLink = intent.getStringExtra("deepLink");
        if (deepLink == null || deepLink.isEmpty()) {
            deepLink = intent.getStringExtra(RideOfferActivity.EXTRA_DEEP_LINK);
        }
        return (deepLink != null && !deepLink.isEmpty()) ? deepLink : null;
    }
}
