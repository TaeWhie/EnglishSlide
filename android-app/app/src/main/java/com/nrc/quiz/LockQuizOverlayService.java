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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Random;

public class LockQuizOverlayService extends Service {
    public static final String ACTION_SYNC_SETTINGS = "com.nrc.quiz.SYNC_LOCKSCREEN_SETTINGS";
    static final String PREFS = "nrc_native_settings";
    static final String KEY_ENABLED = "lockscreen_enabled";
    static final String KEY_REWARD_PROMPT = "lockscreen_reward_prompt";

    private static final String CHANNEL_ID = "lock_quiz_service";
    private static final long ONE_DAY_MS = 24 * 60 * 60 * 1000L;
    
    private KeyguardManager keyguardManager;
    private WordEntry currentNotificationWord;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action)) {
                refreshNotification();
                showLockQuizIfLocked();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_ON));
        refreshNotification();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        refreshNotification();
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

    private void refreshNotification() {
        currentNotificationWord = loadRandomWordForToday();
        startForeground(41, buildNotification());
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

        String title = "오늘의 단어";
        String content = "잠금화면 퀴즈가 활성화되어 있습니다.";
        
        if (currentNotificationWord != null) {
            title = currentNotificationWord.word + " [" + currentNotificationWord.part + "]";
            content = currentNotificationWord.korean;
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        
        return builder
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(content)
                .setSubText("NRC Quiz 학습 중")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_LOW)
                .build();
    }

    private WordEntry loadRandomWordForToday() {
        try {
            InputStream input = getAssets().open("www/data/words.json");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            JSONArray words = new JSONArray(output.toString(StandardCharsets.UTF_8.name()));
            
            // Calculate today's unit (Simplified)
            int maxUnit = 1;
            List<WordEntry> allWords = new ArrayList<>();
            for (int i = 0; i < words.length(); i++) {
                JSONObject word = words.getJSONObject(i);
                WordEntry entry = new WordEntry(
                        word.optString("word", ""),
                        word.optString("part", ""),
                        word.optInt("unit", 1),
                        word.optString("korean", ""),
                        word.optString("english", "")
                );
                maxUnit = Math.max(maxUnit, entry.unit);
                allWords.add(entry);
            }

            Calendar start = Calendar.getInstance();
            start.set(2026, Calendar.MAY, 5, 0, 0, 0);
            Calendar today = Calendar.getInstance();
            long dayOffset = (today.getTimeInMillis() - start.getTimeInMillis()) / ONE_DAY_MS;
            int todayUnit = (int) Math.floorMod(dayOffset, maxUnit) + 1;

            List<WordEntry> todayWords = new ArrayList<>();
            for (WordEntry e : allWords) {
                if (e.unit == todayUnit) todayWords.add(e);
            }

            if (!todayWords.isEmpty()) {
                return todayWords.get(new Random().nextInt(todayWords.size()));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Lockscreen quiz",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("잠금화면 상태 및 오늘의 단어를 표시합니다.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    private static class WordEntry {
        final String word, part, korean, english;
        final int unit;
        WordEntry(String word, String part, int unit, String korean, String english) {
            this.word = word; this.part = part; this.unit = unit; this.korean = korean; this.english = english;
        }
    }
}
