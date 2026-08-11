package br.com.movecity.passenger;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte mínima Native → React, baseada no consumo one-shot usado no Motorista. */
@CapacitorPlugin(name = "PassengerDeepLink")
public class PassengerDeepLinkPlugin extends Plugin {
    private static PassengerDeepLinkPlugin activeInstance;

    @Override
    public void load() {
        activeInstance = this;
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        String deepLink = PassengerDeepLinkStore.consume(getContext());
        JSObject result = new JSObject();
        if (deepLink != null) result.put("deepLink", deepLink);
        call.resolve(result);
    }

    /** Avisa o React quando onNewIntent ocorre sem nova transição de lifecycle. */
    public static void notifyPending() {
        PassengerDeepLinkPlugin instance = activeInstance;
        if (instance != null) {
            instance.notifyListeners("deepLinkAvailable", new JSObject());
        }
    }
}
