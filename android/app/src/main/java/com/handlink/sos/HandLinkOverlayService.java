package com.handlink.sos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import androidx.core.app.NotificationCompat;

/** A user-enabled dashboard shortcut. It never captures content, location, or camera data. */
public class HandLinkOverlayService extends Service {
    public static final String OPEN_DASHBOARD = "com.handlink.sos.OPEN_DASHBOARD";
    private static final String STOP = "com.handlink.sos.HIDE_OVERLAY";
    private static final String CHANNEL = "handlink_floating_button";
    private static final int NOTIFICATION = 7401;
    private static volatile boolean active;
    private static volatile String message = "";
    private WindowManager windows;
    private View bubble;
    private final Handler monitor = new Handler(Looper.getMainLooper());
    private final Runnable permissionMonitor = new Runnable() {
        @Override public void run() {
            if (!Settings.canDrawOverlays(HandLinkOverlayService.this)) stopSelf();
            else monitor.postDelayed(this, 5000);
        }
    };

    public static boolean isActive() { return active; }
    public static String statusMessage() { return message; }
    @Override public IBinder onBind(Intent intent) { return null; }

    private Intent dashboardIntent() {
        return new Intent(this, MainActivity.class).setAction(OPEN_DASHBOARD)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        ResultReceiver receiver = intent.getParcelableExtra("result");
        try {
            if (!Settings.canDrawOverlays(this)) throw new SecurityException("Overlay permission removed");
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel(CHANNEL, "HandLink floating button", NotificationManager.IMPORTANCE_LOW);
                getSystemService(NotificationManager.class).createNotificationChannel(channel);
            }
            PendingIntent open = PendingIntent.getActivity(this, 7401, dashboardIntent(), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            PendingIntent hide = PendingIntent.getService(this, 7402, new Intent(this, HandLinkOverlayService.class).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notice = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("HandLink floating button")
                .setContentText("Tap the button to open your dashboard. No SOS is sent automatically.")
                .setContentIntent(open).setOngoing(true).addAction(0, "Hide button", hide).build();
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTIFICATION, notice);
            if (bubble == null) showBubble();
            active = true;
            monitor.removeCallbacks(permissionMonitor);
            monitor.postDelayed(permissionMonitor, 5000);
            message = "Floating button is visible. Drag to move; tap to open HandLink.";
            if (receiver != null) receiver.send(1, Bundle.EMPTY);
        } catch (RuntimeException exception) {
            message = "Floating button stopped. Check display permission in Android Settings.";
            if (receiver != null) receiver.send(0, Bundle.EMPTY);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void showBubble() {
        windows = getSystemService(WindowManager.class);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.HORIZONTAL);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(35, 39, 23));
        background.setCornerRadius(dp(24));
        background.setStroke(dp(1), Color.rgb(219, 225, 181));
        container.setBackground(background);
        ImageButton open = new ImageButton(this);
        open.setImageResource(R.drawable.ic_floating_dots);
        open.setBackgroundColor(Color.TRANSPARENT);
        open.setContentDescription("Open HandLink dashboard");
        open.setPadding(dp(12), dp(12), dp(12), dp(12));
        open.setOnClickListener(view -> {
            try { startActivity(dashboardIntent()); }
            catch (RuntimeException exception) { message = "Open HandLink from its app icon."; }
        });
        container.addView(open, new LinearLayout.LayoutParams(dp(48), dp(48)));
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(dp(48), dp(48), type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(16);
        params.y = dp(160);
        open.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY;
            int startX, startY;
            boolean dragged;
            @Override public boolean onTouch(View view, MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    downX = event.getRawX(); downY = event.getRawY(); startX = params.x; startY = params.y; dragged = false;
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                    if (Math.hypot(dx, dy) > ViewConfiguration.get(view.getContext()).getScaledTouchSlop()) dragged = true;
                    if (dragged) {
                        android.graphics.Rect bounds = new android.graphics.Rect();
                        if (Build.VERSION.SDK_INT >= 30) bounds.set(windows.getCurrentWindowMetrics().getBounds());
                        else { android.util.DisplayMetrics metrics = getResources().getDisplayMetrics(); bounds.set(0, 0, metrics.widthPixels, metrics.heightPixels); }
                        params.x = Math.max(0, Math.min(Math.round(startX + dx), Math.max(0, bounds.width() - params.width)));
                        params.y = Math.max(0, Math.min(Math.round(startY + dy), Math.max(0, bounds.height() - params.height - dp(24))));
                        try { windows.updateViewLayout(container, params); }
                        catch (RuntimeException exception) { stopSelf(); }
                    }
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_UP) { if (!dragged) view.performClick(); return true; }
                return event.getActionMasked() == MotionEvent.ACTION_CANCEL;
            }
        });
        windows.addView(container, params);
        bubble = container;
    }

    @Override public void onDestroy() {
        active = false;
        message = "Floating button is off.";
        monitor.removeCallbacks(permissionMonitor);
        if (bubble != null && windows != null) {
            try { windows.removeView(bubble); } catch (RuntimeException ignored) { /* Permission revocation may already remove it. */ }
        }
        bubble = null;
        stopForeground(true);
        super.onDestroy();
    }
}
