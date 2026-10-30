package com.handlink.sos;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

public class LocationSharingService extends Service implements LocationListener {
    public static volatile boolean active = false;
    public static volatile String activeSessionId = "";
    public static volatile String statusMessage = "";
    private static final String CHANNEL = "handlink-location";
    private static final String TIMER_CHANNEL = "handlink-safety-timer";
    private static final int ONGOING_ID = 4101;
    private static final int WARNING_ID = 4103;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean closed = false;
    private volatile HttpURLConnection connection;
    private LocationManager locations;
    private Location latest;
    private String origin;
    private long expiresAt;

    private final Runnable expiryWarning = () -> {
        if (closed || !active || System.currentTimeMillis() >= expiresAt) return;
        long remaining = expiresAt - System.currentTimeMillis();
        if (remaining > 60000) {
            main.postDelayed(this.expiryWarning, remaining - 60000);
            return;
        }
        android.content.SharedPreferences notices = getSharedPreferences("sharing-notices", MODE_PRIVATE);
        if (activeSessionId.equals(notices.getString("warned-session", ""))) return;
        try {
            getSystemService(NotificationManager.class).notify(WARNING_ID,
                notification("HandLink sharing ends soon", "Your location sharing stops in less than a minute. Open HandLink to check your timer.", false));
            notices.edit().putString("warned-session", activeSessionId).apply();
        } catch (SecurityException ignored) { /* Notifications can be disabled while sharing is active. */ }
    };

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (closed) return;
            if (System.currentTimeMillis() >= expiresAt) { end("Your location-sharing timer ended.", true); return; }
            synchronize();
            main.postDelayed(this, 30000);
        }
    };

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("stop-updates".equals(intent.getAction())) { end("Screen-off updates disabled. Sharing can continue while the app is open.", false); return START_NOT_STICKY; }
        String id = intent.getStringExtra("sessionId");
        if (active && activeSessionId.equals(id)) return START_NOT_STICKY;
        if (active) { end("Previous screen-off updates stopped. Enable updates for the new session.", false); return START_NOT_STICKY; }
        origin = intent.getStringExtra("origin");
        expiresAt = intent.getLongExtra("expiresAt", 0);
        if (id == null || origin == null || expiresAt <= System.currentTimeMillis()) { stopSelf(); return START_NOT_STICKY; }
        activeSessionId = id;
        statusMessage = "Screen-off updates active. Android may pause updates under battery restrictions.";
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_LOW));
            manager.createNotificationChannel(new NotificationChannel(TIMER_CHANNEL, "Safety timers", NotificationManager.IMPORTANCE_HIGH));
        }
        try {
            Notification notification = notification(statusMessage, true);
            if (Build.VERSION.SDK_INT >= 29) startForeground(ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(ONGOING_ID, notification);
            active = true;
            manager.cancel(WARNING_ID);
            locations = (LocationManager) getSystemService(LOCATION_SERVICE);
            if (!hasLocationPermission()) throw new SecurityException();
            boolean provider = false;
            if (locations.isProviderEnabled(LocationManager.GPS_PROVIDER) && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 300000, 0, this, Looper.getMainLooper());
                provider = true;
            }
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 300000, 0, this, Looper.getMainLooper());
                provider = true;
            }
            if (!provider) throw new IllegalStateException();
            main.post(ticker);
            main.postDelayed(expiryWarning, Math.max(0, expiresAt - System.currentTimeMillis() - 60000));
        } catch (Exception failure) {
            end("Screen-off updates stopped. Enable phone location and notification permissions, then try again.", false);
        }
        // Never restart tracking automatically after the OS kills the service.
        return START_NOT_STICKY;
    }

    private boolean hasLocationPermission() {
        return HandLinkPermissionsPlugin.isAccessEnabled(this, "location") && (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED);
    }

    private Notification notification(String message, boolean ongoing) {
        return notification(ongoing ? "HandLink location sharing" : "HandLink timer ended", message, ongoing);
    }

    private Notification notification(String title, String message, boolean ongoing) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, ongoing ? CHANNEL : TIMER_CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(title)
            .setContentText(message).setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(pending).setOngoing(ongoing).setOnlyAlertOnce(ongoing).setAutoCancel(!ongoing)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        if (ongoing) {
            Intent pause = new Intent(this, LocationSharingService.class).setAction("stop-updates");
            PendingIntent action = PendingIntent.getService(this, 2, pause, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(android.R.drawable.ic_media_pause, "Pause screen-off updates", action);
        }
        return builder.build();
    }

    @Override public void onLocationChanged(Location location) {
        if (closed || !HandLinkPermissionsPlugin.isAccessEnabled(this, "location") || System.currentTimeMillis() >= expiresAt) return;
        latest = new Location(location);
        synchronize();
    }
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) { statusMessage = "Location provider disabled. Turn phone location on to resume updates."; }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    private static String iso(long time) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new java.util.Date(time));
    }
    private static long parseIso(String time) throws Exception {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.parse(time).getTime();
    }

    private void synchronize() {
        if (closed || !active || !busy.compareAndSet(false, true)) return;
        final Location point = latest == null ? null : new Location(latest);
        final String id = activeSessionId;
        network.execute(() -> {
            PowerManager.WakeLock awake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HandLink:location-upload");
            try {
                awake.acquire(45000);
                if (!hasLocationPermission()) { main.post(() -> end("Location permission was removed. Screen-off updates stopped.", false)); return; }
                JSONObject result = request("GET", "/api/sharing/" + id, null);
                if (closed || result == null) return;
                JSONObject session = result.getJSONObject("session");
                if ("expired".equals(session.optString("status"))) { main.post(() -> end("Your location-sharing timer ended.", true)); return; }
                if (!id.equals(session.getString("id")) || !session.getBoolean("isOwner") || !"active".equals(session.getString("status"))) { main.post(() -> end("Location sharing ended or this account changed.", false)); return; }
                if (point == null || System.currentTimeMillis() - point.getTime() > 300000) return;
                JSONObject previous = session.optJSONObject("point");
                if (previous != null && System.currentTimeMillis() - parseIso(previous.getString("recordedAt")) < 300000) return;
                if (closed || System.currentTimeMillis() >= expiresAt) return;
                JSONObject body = new JSONObject().put("latitude", point.getLatitude()).put("longitude", point.getLongitude())
                    .put("accuracy", point.getAccuracy()).put("recordedAt", iso(point.getTime()));
                if (request("POST", "/api/sharing/" + id + "/points", body) != null) {
                    statusMessage = "Screen-off updates active. Last received update: " + new java.util.Date().toString();
                }
            } catch (Exception failure) {
                if (!closed) statusMessage = "Location update paused. Check USB/server connection, network, and phone location. Retrying while this service runs.";
            } finally {
                if (awake.isHeld()) awake.release();
                busy.set(false);
                if (!closed) main.post(() -> getSystemService(NotificationManager.class).notify(ONGOING_ID, notification(statusMessage, true)));
            }
        });
    }

    private JSONObject request(String method, String path, JSONObject body) throws Exception {
        if (closed || !HandLinkPermissionsPlugin.isAccessEnabled(this, "location")) return null;
        String cookies = CookieManager.getInstance().getCookie(origin);
        if (cookies == null || cookies.isEmpty()) { main.post(() -> end("Sign in again. Screen-off updates stopped.", false)); return null; }
        HttpURLConnection http = (HttpURLConnection) new URL(origin + path).openConnection();
        connection = http;
        try {
            http.setInstanceFollowRedirects(false);
            http.setConnectTimeout(15000);
            http.setReadTimeout(15000);
            http.setRequestMethod(method);
            http.setRequestProperty("Cookie", cookies);
            http.setRequestProperty("Accept", "application/json");
            http.setRequestProperty("Cache-Control", "no-store");
            if (body != null) {
                http.setRequestProperty("Origin", origin);
                http.setRequestProperty("Content-Type", "application/json");
                http.setDoOutput(true);
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                http.setFixedLengthStreamingMode(payload.length);
                try (java.io.OutputStream output = http.getOutputStream()) { output.write(payload); }
            }
            int status = http.getResponseCode();
            if (status == 401 || status == 403 || status == 404 || status == 409 || status == 410) { main.post(() -> end("Sharing ended or sign-in is no longer valid. Screen-off updates stopped.", false)); return null; }
            if (status == 429) return null;
            if (status != 200) throw new IllegalStateException("Server request failed.");
            try (InputStream input = http.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int size;
                while ((size = input.read(buffer)) != -1) { if (output.size() + size > 32768) throw new IllegalStateException("Response too large."); output.write(buffer, 0, size); }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { http.disconnect(); if (connection == http) connection = null; }
    }

    private void end(String message, boolean expired) {
        if (closed) return;
        statusMessage = message;
        if (expired) getSystemService(NotificationManager.class).notify(4102, notification(message + " Open HandLink to check your notifications.", false));
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        cleanup();
    }
    private void cleanup() {
        closed = true;
        active = false;
        activeSessionId = "";
        getSystemService(NotificationManager.class).cancel(WARNING_ID);
        main.removeCallbacksAndMessages(null);
        if (connection != null) connection.disconnect();
        if (locations != null) { try { locations.removeUpdates(this); } catch (SecurityException ignored) { /* Permission can be revoked while the service runs. */ } }
        network.shutdownNow();
    }
    @Override public void onDestroy() { if (!closed) statusMessage = "Screen-off updates disabled. Sharing can continue while the app is open."; cleanup(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
