package dz.maktabati.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String NOTIFICATION_CHANNEL_ID = "maktabati_notifications";
    private static final String APP_URL = "https://maktabati-1-rpeo.onrender.com/";
    private MaktabatiPushBridge pushBridge;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        installPushBridge();
        handlePushIntent(getIntent());
    }

    private void installPushBridge() {
        WebView webView = getBridge().getWebView();
        pushBridge = new MaktabatiPushBridge(this, webView);
        webView.addJavascriptInterface(pushBridge, "MaktabatiNativePush");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePushIntent(intent);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (pushBridge != null) pushBridge.onPermissionResult(requestCode, grantResults);
    }

    private void handlePushIntent(Intent intent) {
        if (intent == null) return;
        String link = intent.getStringExtra("link");
        if (link == null || link.trim().isEmpty()) {
            return;
        }
        link = link.trim();
        if (link.startsWith("http://") || link.startsWith("https://")) {
            if (!link.startsWith(APP_URL)) return;
            navigateTo(link);
            return;
        }
        if (link.startsWith("/")) link = link.substring(1);
        navigateTo(APP_URL + link);
    }

    private void navigateTo(String url) {
        final String safeUrl = JSONObject.quote(url);
        getBridge().getWebView().postDelayed(() ->
                getBridge().getWebView().evaluateJavascript(
                        "window.location.href=" + safeUrl + ";",
                        null
                ),
                1200
        );
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "إشعارات مكتبتي",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("إشعارات جديدة من منصة مكتبتي");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}
