package com.handlink.sos;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.net.URI;

@CapacitorPlugin(name = "HandLinkLocation", permissions = {
    @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public class HandLinkLocationPlugin extends Plugin {
    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!HandLinkPermissionsPlugin.isAccessEnabled(getContext(), "location")) { call.reject("Location access is off in HandLink Settings."); return; }
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            requestPermissionForAlias("location", call, "locationPermissionResult");
            return;
        }
        requestNotifications(call);
    }

    @PermissionCallback
    private void locationPermissionResult(PluginCall call) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            call.reject("Allow location access in Android settings before enabling screen-off updates.");
            return;
        }
        requestNotifications(call);
    }

    private void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        launchService(call);
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        launchService(call);
    }

    private void launchService(PluginCall call) {
        if (!HandLinkPermissionsPlugin.isAccessEnabled(getContext(), "location")) { call.reject("Location access is off in HandLink Settings."); return; }
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.reject("Allow HandLink notifications in Android settings so ongoing location sharing stays visible.");
            return;
        }
        try {
            String id = call.getString("sessionId", "");
            Long expiry = call.getLong("expiresAt");
            if (!id.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}") || expiry == null || expiry <= System.currentTimeMillis() || expiry > System.currentTimeMillis() + 14460000L) {
                call.reject("Start a valid sharing session and check the phone's automatic date and time.");
                return;
            }
            // Native requests can use only the app's configured server, never a caller-supplied URL.
            String configured = getBridge().getServerUrl();
            if (configured == null) throw new IllegalArgumentException("Prepare the Android app with your HandLink server first.");
            URI server = new URI(configured);
            String host = server.getHost();
            boolean localDebug = BuildConfig.DEBUG && "http".equals(server.getScheme()) && ("localhost".equals(host) || "127.0.0.1".equals(host));
            if ((!"https".equals(server.getScheme()) && !localDebug) || host == null || server.getUserInfo() != null) {
                throw new IllegalArgumentException("HandLink needs HTTPS, or localhost USB forwarding in a debug build.");
            }
            String origin = new URI(server.getScheme(), null, host, server.getPort(), null, null, null).toString();
            Intent intent = new Intent(getContext(), LocationSharingService.class);
            intent.putExtra("sessionId", id);
            intent.putExtra("expiresAt", expiry);
            intent.putExtra("origin", origin);
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception failure) {
            call.reject("Could not enable screen-off updates. Keep the app open, allow location and notifications, and check the server setup.");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), LocationSharingService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", LocationSharingService.active);
        result.put("sessionId", LocationSharingService.activeSessionId.isEmpty() ? org.json.JSONObject.NULL : LocationSharingService.activeSessionId);
        result.put("message", LocationSharingService.statusMessage);
        call.resolve(result);
    }
}
