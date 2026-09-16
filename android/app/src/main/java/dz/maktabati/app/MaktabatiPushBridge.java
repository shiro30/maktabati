package dz.maktabati.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

public class MaktabatiPushBridge {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4817;
    private final Activity activity;
    private final WebView webView;

    public MaktabatiPushBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public String requestPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted";
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return "granted";
        }
        ActivityCompat.requestPermissions(
                activity,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST
        );
        return "requested";
    }

    @JavascriptInterface
    public void register() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                notifyJavascript("MaktabatiNativePushError", "تعذر الحصول على رمز FCM.");
                return;
            }
            notifyJavascript("MaktabatiNativePushToken", task.getResult());
        });
    }

    public void onPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            register();
        } else {
            notifyJavascript("MaktabatiNativePushPermission", "denied");
        }
    }

    private void notifyJavascript(String functionName, String value) {
        final String safe = JSONObject.quote(value == null ? "" : value);
        activity.runOnUiThread(() -> {
            webView.post(() -> webView.evaluateJavascript(
                    "(function(){if(typeof window." + functionName + "==='function'){window." + functionName + "(" + safe + ");}else{setTimeout(function(){if(typeof window." + functionName + "==='function'){window." + functionName + "(" + safe + ");}},700);}})();",
                    null
            ));
        });
    }
}
