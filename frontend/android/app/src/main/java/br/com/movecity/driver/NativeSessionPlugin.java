package br.com.movecity.driver;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeSession")
public class NativeSessionPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String token = call.getString("token");
        String refreshToken = call.getString("refreshToken");
        String apiBase = call.getString("apiBase");
        NativeSessionStore.save(getContext(), token, refreshToken, apiBase);
        call.resolve();
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        String token = NativeSessionStore.getToken(getContext());
        String refreshToken = NativeSessionStore.getRefreshToken(getContext());
        if (token != null) ret.put("token", token);
        if (refreshToken != null) ret.put("refreshToken", refreshToken);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NativeSessionStore.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void consumePendingDeepLink(PluginCall call) {
        String deepLink = NativeDeepLinkStore.consume(getContext());
        JSObject ret = new JSObject();
        if (deepLink != null) {
            ret.put("deepLink", deepLink);
        }
        call.resolve(ret);
    }
}
