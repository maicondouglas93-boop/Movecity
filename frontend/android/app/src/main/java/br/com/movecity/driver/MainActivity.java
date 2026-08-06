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
        super.onCreate(savedInstanceState);
        RideOfferNotifier.ensureChannel(this);
        DriverAlertNotifier.ensureChannel(this);
        NativeDeepLinkStore.fromIntentExtras(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        NativeDeepLinkStore.fromIntentExtras(this, intent);
    }
}
