package br.com.movecity.driver;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Bridge JS → RideOfferNotifier. Usado quando o socket entrega a oferta com o
 * app aberto (tela desbloqueada): FSI do sistema vira só heads-up; aqui abrimos
 * a Activity nativa na hora.
 */
@CapacitorPlugin(name = "NativeRideOffer")
public class NativeRideOfferPlugin extends Plugin {

    @PluginMethod
    public void presentOffer(PluginCall call) {
        JSObject data = call.getData();
        if (data == null) {
            call.reject("data obrigatória");
            return;
        }
        Map<String, String> map = new HashMap<>();
        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = data.get(key);
            if (value != null && !JSObject.NULL.equals(value)) {
                map.put(key, String.valueOf(value));
            }
        }
        if (!map.containsKey("type")) {
            String kind = map.get("kind");
            if ("parcel".equalsIgnoreCase(kind)) {
                map.put("type", "NEW_PARCEL");
            } else {
                map.put("type", "NEW_RIDE");
            }
        }
        RideOfferNotifier.showFullScreenOffer(getContext(), map);
        call.resolve();
    }
}
