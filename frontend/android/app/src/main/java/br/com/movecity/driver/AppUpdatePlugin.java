package br.com.movecity.driver;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Download + instalação de APK (distribuição fora da Play Store).
 * URL deve vir do backend confiável; valida HTTPS e SHA-256 obrigatório.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final String TAG = "AppUpdate";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                info = pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0));
            } else {
                info = pm.getPackageInfo(pkg, 0);
            }
            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            ret.put("versionCode", code);
            ret.put("packageName", pkg);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject ret = new JSObject();
        boolean can = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            can = getContext().getPackageManager().canRequestPackageInstalls();
        }
        ret.put("canInstall", can);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } else {
                Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelRequested.set(true);
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String apkUrl = call.getString("apkUrl", "");
        String expectedSha = call.getString("sha256", "");
        long expectedSize = 0L;
        Double fileSizeNum = call.getDouble("fileSize");
        if (fileSizeNum != null && fileSizeNum > 0) {
            expectedSize = fileSizeNum.longValue();
        }

        if (apkUrl == null || apkUrl.trim().isEmpty()) {
            call.reject("apkUrl ausente");
            return;
        }
        apkUrl = apkUrl.trim();
        if (!apkUrl.toLowerCase().startsWith("https://")
                && !apkUrl.toLowerCase().startsWith("http://192.168.")
                && !apkUrl.toLowerCase().startsWith("http://10.")
                && !apkUrl.toLowerCase().startsWith("http://localhost")) {
            call.reject("URL do APK deve usar HTTPS");
            return;
        }
        String shaNormalized = expectedSha != null ? expectedSha.trim().toLowerCase() : "";
        if (shaNormalized.isEmpty() || !shaNormalized.matches("^[a-f0-9]{64}$")) {
            call.reject("SHA-256 do APK é obrigatório (64 hex)");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("Download já em andamento");
            return;
        }
        cancelRequested.set(false);
        call.setKeepAlive(true);

        final String urlFinal = apkUrl;
        final String shaFinal = shaNormalized;
        final long sizeFinal = expectedSize;

        executor.execute(() -> {
            File outFile = null;
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getExternalFilesDir(null), "apk");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("Não foi possível criar pasta de download");
                }
                outFile = new File(dir, "movecity-update.apk");
                if (outFile.exists() && !outFile.delete()) {
                    Log.w(TAG, "Falha ao apagar APK anterior");
                }

                notifyProgress(call, 0, 0, sizeFinal);

                URL url = new URL(urlFinal);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new Exception("Download falhou HTTP " + code);
                }
                long total = conn.getContentLength();
                if (total <= 0 && sizeFinal > 0) total = sizeFinal;

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[8192];
                    long downloaded = 0;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (cancelRequested.get()) {
                            throw new Exception("Download cancelado");
                        }
                        out.write(buf, 0, n);
                        downloaded += n;
                        int percent = total > 0 ? (int) Math.min(99, (downloaded * 100) / total) : 0;
                        notifyProgress(call, percent, downloaded, total);
                    }
                    out.flush();
                }

                if (!outFile.exists() || outFile.length() < 1024) {
                    throw new Exception("Arquivo APK incompleto");
                }
                if (sizeFinal > 0 && outFile.length() != sizeFinal) {
                    throw new Exception("Tamanho do APK não confere");
                }

                String actual = sha256File(outFile);
                if (!shaFinal.equals(actual)) {
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                    throw new Exception("SHA-256 do APK não confere — instalação bloqueada");
                }
                Log.i(TAG, "hash validado");

                notifyProgress(call, 100, outFile.length(), outFile.length());

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    JSObject needPerm = new JSObject();
                    needPerm.put("needsInstallPermission", true);
                    needPerm.put("localPath", outFile.getAbsolutePath());
                    call.resolve(needPerm);
                    return;
                }

                openInstaller(outFile);
                JSObject ok = new JSObject();
                ok.put("installedOpened", true);
                ok.put("localPath", outFile.getAbsolutePath());
                call.resolve(ok);
            } catch (Exception e) {
                Log.e(TAG, "download falhou: " + e.getMessage());
                if (outFile != null && outFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                }
                call.reject(e.getMessage() != null ? e.getMessage() : "Falha no download");
            } finally {
                if (conn != null) conn.disconnect();
                downloading.set(false);
                call.release(getBridge());
            }
        });
    }

    @PluginMethod
    public void installLocalApk(PluginCall call) {
        String path = call.getString("localPath", "");
        if (path == null || path.isEmpty()) {
            call.reject("localPath ausente");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            call.reject("Arquivo APK não encontrado");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                call.reject("Permissão de instalação necessária");
                return;
            }
            openInstaller(file);
            JSObject ok = new JSObject();
            ok.put("installedOpened", true);
            call.resolve(ok);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void openInstaller(File apkFile) throws Exception {
        Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apkFile
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        Log.i(TAG, "instalador aberto");
    }

    private void notifyProgress(PluginCall call, int percent, long downloaded, long total) {
        JSObject data = new JSObject();
        data.put("percent", percent);
        data.put("downloaded", downloaded);
        data.put("total", total);
        notifyListeners("downloadProgress", data);
    }

    private static String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                digest.update(buf, 0, n);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
