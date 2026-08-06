package br.com.movecity.driver;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import androidx.annotation.Nullable;

import java.lang.ref.WeakReference;

/**
 * Activity retomada no momento — permite abrir RideOfferActivity a partir do
 * contexto de UI (BAL não bloqueia) quando o FCM chega com o app em foreground.
 */
public final class CurrentActivityHolder {
    private static WeakReference<Activity> current = new WeakReference<>(null);
    private static boolean registered = false;

    private CurrentActivityHolder() {}

    public static synchronized void install(Application app) {
        if (registered || app == null) return;
        registered = true;
        app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityResumed(Activity activity) {
                current = new WeakReference<>(activity);
            }

            @Override public void onActivityPaused(Activity activity) {
                Activity cur = current.get();
                if (cur == activity) current = new WeakReference<>(null);
            }

            @Override public void onActivityCreated(Activity a, Bundle b) {}
            @Override public void onActivityStarted(Activity a) {}
            @Override public void onActivityStopped(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
            @Override public void onActivityDestroyed(Activity a) {
                Activity cur = current.get();
                if (cur == a) current = new WeakReference<>(null);
            }
        });
    }

    @Nullable
    public static Activity get() {
        return current.get();
    }
}
