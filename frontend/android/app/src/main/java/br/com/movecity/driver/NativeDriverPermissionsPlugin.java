package br.com.movecity.driver;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.app.NotificationManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Status + atalhos de settings para ofertas full-screen e OEMs (MIUI/Xiaomi).
 */
@CapacitorPlugin(name = "NativeDriverPermissions")
public class NativeDriverPermissionsPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        String brand = Build.BRAND != null ? Build.BRAND : "";
        ret.put("manufacturer", manufacturer);
        ret.put("brand", brand);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("isXiaomiFamily", isXiaomiFamily(manufacturer, brand));

        boolean canFsi = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            canFsi = nm != null && nm.canUseFullScreenIntent();
        }
        ret.put("canUseFullScreenIntent", canFsi);

        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        boolean ignoringBattery = true;
        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ignoringBattery = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        ret.put("ignoringBatteryOptimizations", ignoringBattery);

        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } else {
                openAppDetails();
            }
            call.resolve();
        } catch (Exception e) {
            try {
                openAppDetails();
                call.resolve();
            } catch (Exception e2) {
                call.reject(e2.getMessage());
            }
        }
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } else {
                openAppDetails();
            }
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject(e2.getMessage());
            }
        }
    }

    @PluginMethod
    public void openOemAutostartSettings(PluginCall call) {
        if (tryStart(miuiAutostartIntent())
            || tryStart(miuiAutostartAltIntent())
            || tryStart(huaweiStartupIntent())
            || tryStart(oppoStartupIntent())
            || tryStart(vivoStartupIntent())) {
            call.resolve(ok(true));
            return;
        }
        try {
            openAppDetails();
            call.resolve(ok(false));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openOemOtherPermissions(PluginCall call) {
        // Xiaomi: “outras permissões” (janelas pop-up em segundo plano, tela bloqueada…)
        if (tryStart(miuiPermEditorIntent())
            || tryStart(miuiPermEditorLegacyIntent())) {
            call.resolve(ok(true));
            return;
        }
        try {
            openAppDetails();
            call.resolve(ok(false));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private JSObject ok(boolean oemSpecific) {
        JSObject ret = new JSObject();
        ret.put("oemSpecific", oemSpecific);
        return ret;
    }

    private void openAppDetails() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private boolean tryStart(Intent intent) {
        if (intent == null) return false;
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isXiaomiFamily(String manufacturer, String brand) {
        String m = manufacturer.toLowerCase();
        String b = brand.toLowerCase();
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")
            || b.contains("xiaomi") || b.contains("redmi") || b.contains("poco");
    }

    private Intent miuiAutostartIntent() {
        Intent i = new Intent();
        i.setComponent(new ComponentName(
            "com.miui.securitycenter",
            "com.miui.permcenter.autostart.AutoStartManagementActivity"
        ));
        return i;
    }

    private Intent miuiAutostartAltIntent() {
        Intent i = new Intent("miui.intent.action.OP_AUTO_START");
        i.addCategory(Intent.CATEGORY_DEFAULT);
        return i;
    }

    private Intent miuiPermEditorIntent() {
        Intent i = new Intent("miui.intent.action.APP_PERM_EDITOR");
        i.setClassName(
            "com.miui.securitycenter",
            "com.miui.permcenter.permissions.PermissionsEditorActivity"
        );
        i.putExtra("extra_pkgname", getContext().getPackageName());
        return i;
    }

    private Intent miuiPermEditorLegacyIntent() {
        Intent i = new Intent("miui.intent.action.APP_PERM_EDITOR");
        i.setClassName(
            "com.miui.securitycenter",
            "com.miui.permcenter.permissions.AppPermissionsEditorActivity"
        );
        i.putExtra("extra_pkgname", getContext().getPackageName());
        return i;
    }

    private Intent huaweiStartupIntent() {
        Intent i = new Intent();
        i.setComponent(new ComponentName(
            "com.huawei.systemmanager",
            "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
        ));
        return i;
    }

    private Intent oppoStartupIntent() {
        Intent i = new Intent();
        i.setComponent(new ComponentName(
            "com.coloros.safecenter",
            "com.coloros.safecenter.permission.startup.StartupAppListActivity"
        ));
        return i;
    }

    private Intent vivoStartupIntent() {
        Intent i = new Intent();
        i.setComponent(new ComponentName(
            "com.iqoo.secure",
            "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"
        ));
        return i;
    }
}
