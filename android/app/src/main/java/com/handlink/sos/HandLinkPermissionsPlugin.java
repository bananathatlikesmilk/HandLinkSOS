package com.handlink.sos;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "HandLinkPermissions", permissions = {
    @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
    @Permission(alias = "camera", strings = {Manifest.permission.CAMERA}),
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public class HandLinkPermissionsPlugin extends Plugin {
    private boolean permissionPending;
    private int overlayGeneration;
    private int initialGeneration;

    private boolean granted(String name) {
        return ContextCompat.checkSelfPermission(getContext(), name) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean locationGranted() {
        return granted(Manifest.permission.ACCESS_COARSE_LOCATION) || granted(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private String access(String alias, boolean hasPermission) {
        if (hasPermission) return "granted";
        return getPermissionState(alias) == PermissionState.DENIED ? "denied" : "prompt";
    }

    private JSObject snapshot() {
        boolean overlayAllowed = Settings.canDrawOverlays(getContext());
        if (!overlayAllowed && HandLinkOverlayService.isActive()) {
            getContext().stopService(new Intent(getContext(), HandLinkOverlayService.class));
        }
        JSObject result = new JSObject();
        result.put("location", access("location", locationGranted()));
        result.put("camera", access("camera", granted(Manifest.permission.CAMERA)));
        result.put("overlayAllowed", overlayAllowed);
        result.put("overlayActive", overlayAllowed && HandLinkOverlayService.isActive());
        result.put("initialRequested", getContext().getSharedPreferences("handlink_permissions", 0).getBoolean("initial_requested", false));
        result.put("message", HandLinkOverlayService.statusMessage());
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(snapshot()); }

    @PluginMethod
    public void requestInitial(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getContext().getSharedPreferences("handlink_permissions", 0).getBoolean("initial_requested", false)) {
                call.resolve(snapshot());
                return;
            }
            if (permissionPending) { call.reject("Another permission request is open."); return; }
            // Record the attempt before opening dialogs: declining must not trigger repeated startup prompts.
            getContext().getSharedPreferences("handlink_permissions", 0).edit().putBoolean("initial_requested", true).apply();
            permissionPending = true;
            call.getData().put("initialGeneration", ++initialGeneration);
            if (!locationGranted()) requestPermissionForAlias("location", call, "locationResult");
            else requestCameraNext(call);
        });
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (permissionPending) { call.reject("Another permission request is open."); return; }
            if (locationGranted()) { call.resolve(snapshot()); return; }
            permissionPending = true;
            requestPermissionForAlias("location", call, "locationResult");
        });
    }

    @PermissionCallback
    private void locationResult(PluginCall call) {
        if ("requestInitial".equals(call.getMethodName())) requestCameraNext(call);
        else finishPermissions(call);
    }

    private void requestCameraNext(PluginCall call) {
        if ("requestInitial".equals(call.getMethodName()) && call.getInt("initialGeneration", -1) != initialGeneration) {
            finishPermissions(call);
            return;
        }
        if (granted(Manifest.permission.CAMERA)) finishPermissions(call);
        else requestPermissionForAlias("camera", call, "cameraResult");
    }

    @PluginMethod
    public void requestCamera(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (permissionPending) { call.reject("Another permission request is open."); return; }
            permissionPending = true;
            requestCameraNext(call);
        });
    }

    @PermissionCallback
    private void cameraResult(PluginCall call) { finishPermissions(call); }

    private void finishPermissions(PluginCall call) {
        permissionPending = false;
        call.resolve(snapshot());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
            call.resolve();
        } catch (RuntimeException exception) { call.reject("Open HandLink permissions in Android Settings."); }
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())), "overlaySettingsResult");
        } catch (RuntimeException exception) { call.reject("Open Display over other apps for HandLink in Android Settings."); }
    }

    @ActivityCallback
    private void overlaySettingsResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve();
    }

    @PluginMethod
    public void startOverlay(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.getData().put("overlayGeneration", ++overlayGeneration);
            if (!Settings.canDrawOverlays(getContext())) { call.reject("Allow display over other apps first."); return; }
            if (permissionPending) { call.reject("Finish the current permission request first."); return; }
            if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
                permissionPending = true;
                requestPermissionForAlias("notifications", call, "overlayNotificationsResult");
            } else launchOverlay(call);
        });
    }

    @PermissionCallback
    private void overlayNotificationsResult(PluginCall call) {
        permissionPending = false;
        launchOverlay(call);
    }

    private void launchOverlay(PluginCall call) {
        final int generation = call.getInt("overlayGeneration", -1);
        if (generation != overlayGeneration) { call.reject("Floating button request was cancelled."); return; }
        if (!Settings.canDrawOverlays(getContext())) { call.reject("Display permission was removed."); return; }
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.reject("Allow HandLink notifications to show the floating button's ongoing notification.");
            return;
        }
        Intent service = new Intent(getContext(), HandLinkOverlayService.class);
        service.putExtra("result", new ResultReceiver(new Handler(Looper.getMainLooper())) {
            @Override protected void onReceiveResult(int code, Bundle data) {
                if (generation != overlayGeneration) {
                    getContext().stopService(new Intent(getContext(), HandLinkOverlayService.class));
                    call.reject("Floating button request was cancelled.");
                } else if (code == 1) call.resolve();
                else call.reject("Could not show the floating button. Check Android permissions and try again.");
            }
        });
        try { ContextCompat.startForegroundService(getContext(), service); }
        catch (RuntimeException exception) { call.reject("Open HandLink and enable the floating button from Settings."); }
    }

    @PluginMethod
    public void stopOverlay(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            overlayGeneration++;
            initialGeneration++;
            getContext().stopService(new Intent(getContext(), HandLinkOverlayService.class));
            call.resolve();
        });
    }
}
