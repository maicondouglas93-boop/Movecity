package br.com.movecity.driver;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Aceite/recusa nativos de corrida/encomenda com retry via /captains/refresh se 401.
 */
public final class RideOfferAcceptHelper {
    public static final String KIND_RIDE = "ride";
    public static final String KIND_PARCEL = "parcel";

    private RideOfferAcceptHelper() {}

    public static final class Result {
        public final boolean ok;
        public final String message;

        private Result(boolean ok, String message) {
            this.ok = ok;
            this.message = message;
        }

        static Result success() { return new Result(true, null); }
        static Result fail(String message) { return new Result(false, message); }
    }

    public static Result acceptOffer(Context context, String kind, String offerId) {
        return withAuthRetry(context, (apiBase, token) -> postOfferAction(apiBase, kind, offerId, token, true));
    }

    public static Result declineOffer(Context context, String kind, String offerId) {
        return withAuthRetry(context, (apiBase, token) -> postOfferAction(apiBase, kind, offerId, token, false));
    }

    private interface AuthorizedAction {
        Result run(String apiBase, String token);
    }

    private static Result withAuthRetry(Context context, AuthorizedAction action) {
        String apiBase = NativeSessionStore.getApiBase(context);
        String token = NativeSessionStore.getToken(context);
        if (apiBase == null || apiBase.isEmpty() || token == null || token.isEmpty()) {
            return Result.fail("Faça login novamente no app");
        }
        Result first = action.run(apiBase, token);
        if (first.ok || (first.message != null && !first.message.contains("Sessão expirada"))) {
            return first;
        }
        String refreshed = refreshCaptainToken(context, apiBase);
        if (refreshed == null) {
            return Result.fail("Sessão expirada. Abra o app e entre de novo.");
        }
        return action.run(apiBase, refreshed);
    }

    /** @deprecated use acceptOffer */
    public static Result acceptRide(String apiBase, String rideId, String token) {
        return postOfferAction(apiBase, KIND_RIDE, rideId, token, true);
    }

    private static Result postOfferAction(
        String apiBase,
        String kind,
        String offerId,
        String token,
        boolean accept
    ) {
        HttpURLConnection conn = null;
        try {
            String base = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
            String action = accept ? "accept" : "decline";
            String path = KIND_PARCEL.equals(kind)
                ? "/parcels/" + offerId + "/" + action
                : "/rides/" + offerId + "/" + action;
            URL url = new URL(base + path);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
            }
            int code = conn.getResponseCode();
            InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            String responseBody = readStream(stream);
            if (code >= 200 && code < 300) {
                return Result.success();
            }
            String msg = parseMessage(responseBody);
            if (code == 401) msg = "Sessão expirada. Abra o app e entre de novo.";
            if (accept && code == 409) {
                msg = msg != null ? msg : (KIND_PARCEL.equals(kind)
                    ? "Encomenda já foi aceita."
                    : "Corrida já foi aceita.");
            }
            return Result.fail(msg != null ? msg : ("Erro " + code));
        } catch (Exception e) {
            return Result.fail("Sem conexão com o servidor");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String refreshCaptainToken(Context context, String apiBase) {
        String refresh = NativeSessionStore.getRefreshToken(context);
        if (refresh == null || refresh.isEmpty()) return null;
        HttpURLConnection conn = null;
        try {
            String base = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
            URL url = new URL(base + "/captains/refresh");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            byte[] body = ("{\"refreshToken\":" + JSONObject.quote(refresh) + "}")
                .getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
            }
            int code = conn.getResponseCode();
            InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            String responseBody = readStream(stream);
            if (code < 200 || code >= 300) return null;
            JSONObject obj = new JSONObject(responseBody);
            String token = obj.optString("token", null);
            String nextRefresh = obj.optString("refreshToken", null);
            if (token == null || token.isEmpty()) return null;
            NativeSessionStore.updateTokens(context, token, nextRefresh);
            return token;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(InputStream stream) {
        if (stream == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static String parseMessage(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            if (obj.has("message")) return obj.optString("message", null);
        } catch (Exception ignored) {}
        return null;
    }
}
