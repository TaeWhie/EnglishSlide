package com.nrc.quiz;

import android.app.KeyguardManager;
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
import android.os.Build;
import android.os.IBinder;

public class LockQuizOverlayService extends Service {
    public static final String ACTION_SYNC_SETTINGS = "com.nrc.quiz.SYNC_LOCKSCREEN_SETTINGS";
    static final String PREFS = "nrc_native_settings";
    static final String KEY_ENABLED = "lockscreen_enabled";
    static final String KEY_REWARD_PROMPT = "lockscreen_reward_prompt";

    private static final String CHANNEL_ID = "lock_quiz_service";
    private KeyguardManager keyguardManager;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action)) {
                showLockQuizIfLocked();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_ON));
        startForeground(41, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        showLockQuizIfLocked();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
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

    private boolean isDeviceLocked() {
        return keyguardManager != null && keyguardManager.isKeyguardLocked();
    }

    private void showLockQuizIfLocked() {
        if (!isEnabled() || !isDeviceLocked()) return;

        Intent lockQuiz = new Intent(this, LockQuizActivity.class);
        lockQuiz.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(lockQuiz);
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
}
