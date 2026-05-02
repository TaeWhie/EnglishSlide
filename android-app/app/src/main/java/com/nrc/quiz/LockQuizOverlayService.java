package com.nrc.quiz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
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
import android.widget.TextView;

public class LockQuizOverlayService extends Service {
    public static final String ACTION_SYNC_SETTINGS = "com.nrc.quiz.SYNC_LOCKSCREEN_SETTINGS";
    static final String PREFS = "nrc_native_settings";
    static final String KEY_ENABLED = "lockscreen_enabled";
    static final String KEY_REWARD_PROMPT = "lockscreen_reward_prompt";

    private static final String CHANNEL_ID = "lock_quiz_service";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private View overlayView;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_USER_PRESENT.equals(action)) {
                showOverlay();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_ON));
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_USER_PRESENT));
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
            showOverlay();
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

    private void showOverlay() {
        if (!isEnabled() || !Settings.canDrawOverlays(this) || overlayView != null) return;

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(36, 30, 36, 30);
        panel.setBackgroundColor(Color.rgb(18, 34, 59));

        TextView label = new TextView(this);
        label.setText("NRC Quiz");
        label.setTextColor(Color.rgb(255, 218, 121));
        label.setTextSize(13);
        label.setGravity(Gravity.CENTER);
        panel.addView(label);

        TextView question = new TextView(this);
        question.setText("Benefit의 뜻은?");
        question.setTextColor(Color.WHITE);
        question.setTextSize(22);
        question.setGravity(Gravity.CENTER);
        question.setPadding(0, 18, 0, 12);
        panel.addView(question);

        TextView reward = new TextView(this);
        reward.setText(rewardPromptEnabled() ? "정답 확인하고 포인트를 적립하세요." : "오늘의 영어 퀴즈를 확인하세요.");
        reward.setTextColor(Color.rgb(215, 225, 238));
        reward.setTextSize(14);
        reward.setGravity(Gravity.CENTER);
        panel.addView(reward);

        Button open = new Button(this);
        open.setText("앱에서 풀기");
        open.setOnClickListener(v -> {
            Intent launch = new Intent(this, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(launch);
            removeOverlay();
        });
        panel.addView(open);

        Button dismiss = new Button(this);
        dismiss.setText("닫기");
        dismiss.setOnClickListener(v -> removeOverlay());
        panel.addView(dismiss);

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
        params.y = 80;

        overlayView = panel;
        windowManager.addView(overlayView, params);
        handler.postDelayed(this::removeOverlay, 15000);
    }

    private void removeOverlay() {
        if (overlayView == null) return;
        try {
            windowManager.removeView(overlayView);
        } catch (IllegalArgumentException ignored) {
        }
        overlayView = null;
    }
}
