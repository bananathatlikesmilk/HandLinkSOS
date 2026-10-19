package com.handlink.sos;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;
import java.net.URI;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HandLinkLocationPlugin.class);
        registerPlugin(HandLinkPhonePlugin.class);
        registerPlugin(HandLinkPermissionsPlugin.class);
        super.onCreate(savedInstanceState);
        openDashboard(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openDashboard(intent);
    }

    private void openDashboard(Intent intent) {
        if (intent == null || !HandLinkOverlayService.OPEN_DASHBOARD.equals(intent.getAction()) || getBridge() == null) return;
        try {
            // Only navigate to the configured server. Intent extras can never supply a URL.
            URI server = new URI(getBridge().getServerUrl());
            boolean localDebug = BuildConfig.DEBUG && "http".equals(server.getScheme()) && ("localhost".equals(server.getHost()) || "127.0.0.1".equals(server.getHost()));
            if (server.getHost() == null || server.getUserInfo() != null || (!"https".equals(server.getScheme()) && !localDebug)) return;
            String dashboard = new URI(server.getScheme(), null, server.getHost(), server.getPort(), "/user/dashboard", null, null).toString();
            getBridge().getWebView().loadUrl(dashboard);
        } catch (Exception ignored) { /* Normal app startup remains available if configuration is invalid. */ }
    }
}
