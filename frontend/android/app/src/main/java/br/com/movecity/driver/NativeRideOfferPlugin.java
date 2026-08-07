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
 * app aberto: abre a RideOfferActivity (tela nativa verde) na hora.
 * A Push heads-up da bandeja está desativada — este bridge é o caminho
 * principal com o app em foreground.
 */
@CapacitorPlugin(name = "NativeRideOffer")
public class NativeRideOfferPlugin extends Plugin {

    @PluginMethod
    public void presentOffer(PluginCall call) {
        try {
            JSObject data = call.getData();
            if (data == null) {
                call.reject("data obrigatória");
                return;
            }
            Map<String, String> map = new HashMap<>();
            Iterator<String> keys = data.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!data.has(key) || data.isNull(key)) continue;
                Object value = data.get(key);
                if (value != null) {
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
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "presentOffer failed");
        }
    }
}
