package com.nrc.quiz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.FrameLayout;
import android.widget.TextView;

public class LockQuizOverlayService extends Service {
    public static final String ACTION_SYNC_SETTINGS = "com.nrc.quiz.SYNC_LOCKSCREEN_SETTINGS";
    static final String PREFS = "nrc_native_settings";
    static final String KEY_ENABLED = "lockscreen_enabled";
    static final String KEY_REWARD_PROMPT = "lockscreen_reward_prompt";

    private static final String CHANNEL_ID = "lock_quiz_service";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoRemoveOverlay = this::removeOverlay;
    private WindowManager windowManager;
    private KeyguardManager keyguardManager;
    private View overlayView;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action)) {
                showOverlayIfLocked();
            } else if (Intent.ACTION_USER_PRESENT.equals(action) || Intent.ACTION_SCREEN_OFF.equals(action)) {
                removeOverlay();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_ON));
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_USER_PRESENT));
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        startForeground(41, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled() || !Settings.canDrawOverlays(this)) {
            removeOverlay();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_SYNC_SETTINGS.equals(intent.getAction())) {
            if (!isEnabled()) {
                removeOverlay();
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        removeOverlay();
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private boolean isEnabled() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getBoolean(KEY_ENABLED, false);
    }

    private boolean rewardPromptEnabled() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getBoolean(KEY_REWARD_PROMPT, true);
    }

    private Notification buildNotification() {
        createNotificationChannel();
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("NRC Quiz")
                .setContentText("잠금화면 퀴즈가 켜져 있습니다.")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Lockscreen quiz",
                NotificationManager.IMPORTANCE_LOW
        );
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    private boolean isDeviceLocked() {
        return keyguardManager != null && keyguardManager.isKeyguardLocked();
    }

    private void showOverlayIfLocked() {
        if (!isDeviceLocked()) {
            removeOverlay();
            return;
        }
        showOverlay();
    }

    private GradientDrawable rounded(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private TextView text(String value, int color, float size, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setTypeface(Typeface.DEFAULT, style);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private void showOverlay() {
        if (!isEnabled() || !Settings.canDrawOverlays(this) || overlayView != null || !isDeviceLocked()) return;

        FrameLayout shell = new FrameLayout(this);
        shell.setPadding(28, 28, 28, 0);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(34, 30, 34, 30);
        panel.setBackground(rounded(Color.WHITE, 26));
        panel.setElevation(18f);

        TextView badge = text("잠금화면 퀴즈", Color.rgb(31, 108, 210), 13, Typeface.BOLD);
        badge.setBackground(rounded(Color.rgb(237, 244, 255), 30));
        badge.setPadding(18, 8, 18, 8);
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        badgeParams.gravity = Gravity.CENTER_HORIZONTAL;
        panel.addView(badge, badgeParams);

        TextView score = text("+10P", Color.rgb(18, 34, 59), 34, Typeface.BOLD);
        score.setPadding(0, 18, 0, 0);
        panel.addView(score);

        TextView title = text("Benefit의 뜻은?", Color.rgb(18, 34, 59), 24, Typeface.BOLD);
        title.setPadding(0, 8, 0, 0);
        panel.addView(title);

        TextView sub = text(
                rewardPromptEnabled() ? "정답을 맞히고 오늘 포인트를 적립하세요." : "오늘의 영어 퀴즈를 확인하세요.",
                Color.rgb(95, 107, 123),
                15,
                Typeface.NORMAL
        );
        sub.setPadding(0, 12, 0, 20);
        panel.addView(sub);

        LinearLayout options = new LinearLayout(this);
        options.setOrientation(LinearLayout.VERTICAL);
        options.addView(optionText("A. Benefit"));
        options.addView(optionText("B. Battery"));
        panel.addView(options);

        Button open = new Button(this);
        open.setText("앱에서 풀기");
        open.setTextColor(Color.WHITE);
        open.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        open.setBackground(rounded(Color.rgb(31, 108, 210), 18));
        open.setOnClickListener(v -> {
            Intent launch = new Intent(this, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(launch);
            removeOverlay();
        });
        LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                58
        );
        openParams.setMargins(0, 22, 0, 8);
        panel.addView(open, openParams);

        Button dismiss = new Button(this);
        dismiss.setText("나중에");
        dismiss.setTextColor(Color.rgb(95, 107, 123));
        dismiss.setBackgroundColor(Color.TRANSPARENT);
        dismiss.setOnClickListener(v -> removeOverlay());
        panel.addView(dismiss, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                50
        ));

        shell.addView(panel, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
        ));

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = 72;

        overlayView = shell;
        windowManager.addView(overlayView, params);
        handler.postDelayed(autoRemoveOverlay, 15000);
    }

    private TextView optionText(String value) {
        TextView option = text(value, Color.rgb(18, 34, 59), 16, Typeface.BOLD);
        option.setGravity(Gravity.CENTER_VERTICAL);
        option.setBackground(rounded(Color.rgb(245, 248, 252), 16));
        option.setPadding(20, 0, 20, 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                52
        );
        params.setMargins(0, 0, 0, 8);
        option.setLayoutParams(params);
        return option;
    }

    private void removeOverlay() {
        if (overlayView == null) return;
        handler.removeCallbacks(autoRemoveOverlay);
        try {
            windowManager.removeView(overlayView);
        } catch (IllegalArgumentException ignored) {
        }
        overlayView = null;
    }
}
