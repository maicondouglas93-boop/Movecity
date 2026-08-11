package br.com.movecity.passenger;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PassengerDeepLinkPlugin.class);
        super.onCreate(savedInstanceState);
        PassengerAlertNotifier.ensureChannel(this);
        PassengerDeepLinkStore.fromIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PassengerDeepLinkStore.fromIntent(this, intent);
        PassengerDeepLinkPlugin.notifyPending();
    }
}
