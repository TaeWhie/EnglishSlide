package com.nrc.quiz;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

public class LockQuizActivity extends Activity {
    private static final long ONE_DAY_MS = 24L * 60L * 60L * 1000L;
    private static final float SWIPE_THRESHOLD_DP = 80f;
    private static final float SWIPE_VELOCITY_DP = 400f;

    private final Handler clockHandler = new Handler(Looper.getMainLooper());
    private final List<WordEntry> todayWords = new ArrayList<>();
    private int wordIndex = 0;
    private int todayUnit = 1;
    private int maxUnit = 1;
    private boolean showingEnglishMeaning = false;

    private TextView timeView;
    private TextView dateView;
    private TextView wordView;
    private TextView metaView;
    private TextView meaningView;
    private TextView counterView;
    private TextView unlockHint;
    private TextView quizHint;

    private VelocityTracker velocityTracker;
    private float swipeStartX = 0f;
    private float swipeStartY = 0f;

    private final Runnable clockTick = new Runnable() {
        @Override
        public void run() {
            updateClock();
            clockHandler.postDelayed(this, 30_000L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureLockWindow();

        if (!isEnabled() || !isDeviceLocked()) {
            finish();
            return;
        }

        loadTodayWords();
        setContentView(buildContent());
        updateWord();
        clockTick.run();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
        if (!isEnabled() || !isDeviceLocked()) {
            finish();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    @Override
    protected void onDestroy() {
        clockHandler.removeCallbacks(clockTick);
        super.onDestroy();
    }

    private void configureLockWindow() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        applyImmersiveMode();
    }

    private void applyImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private boolean isEnabled() {
        SharedPreferences prefs = getSharedPreferences(LockQuizOverlayService.PREFS, MODE_PRIVATE);
        return prefs.getBoolean(LockQuizOverlayService.KEY_ENABLED, false);
    }

    private boolean isDeviceLocked() {
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        return keyguardManager != null && keyguardManager.isKeyguardLocked();
    }

    private View buildContent() {
        FrameLayout root = new FrameLayout(this);
        root.setBackground(lockBackground());
        root.setPadding(dp(22), dp(40), dp(22), dp(28));

        // 전체 화면 스와이프 감지
        root.setOnTouchListener((v, event) -> {
            handleSwipeGesture(event);
            return true;
        });

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        // content는 터치를 root로 전달
        content.setOnTouchListener((v, event) -> {
            handleSwipeGesture(event);
            return false;
        });

        timeView = text("", Color.WHITE, 64, Typeface.NORMAL);
        timeView.setIncludeFontPadding(false);
        content.addView(timeView, matchWrap());

        dateView = text("", Color.argb(220, 255, 255, 255), 16, Typeface.BOLD);
        dateView.setPadding(0, dp(8), 0, 0);
        content.addView(dateView, matchWrap());

        View spacerTop = new View(this);
        content.addView(spacerTop, new LinearLayout.LayoutParams(1, 0, 1.15f));

        counterView = text("", Color.argb(215, 255, 255, 255), 14, Typeface.BOLD);
        counterView.setBackground(pill(Color.argb(38, 255, 255, 255), Color.argb(55, 255, 255, 255)));
        counterView.setPadding(dp(16), dp(8), dp(16), dp(8));
        content.addView(counterView, wrapWrap());

        LinearLayout wordRow = new LinearLayout(this);
        wordRow.setGravity(Gravity.CENTER);
        wordRow.setOrientation(LinearLayout.HORIZONTAL);
        wordRow.setPadding(0, dp(18), 0, dp(4));

        TextView prev = roundIcon("‹", 34);
        prev.setOnClickListener(v -> moveWord(-1));
        wordRow.addView(prev, new LinearLayout.LayoutParams(dp(48), dp(48)));

        wordView = text("", Color.WHITE, 44, Typeface.BOLD);
        wordView.setSingleLine(false);
        wordView.setPadding(dp(14), 0, dp(14), 0);
        wordRow.addView(wordView, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView next = roundIcon("›", 34);
        next.setOnClickListener(v -> moveWord(1));
        wordRow.addView(next, new LinearLayout.LayoutParams(dp(48), dp(48)));
        content.addView(wordRow, matchWrap());

        metaView = text("", Color.argb(210, 255, 255, 255), 15, Typeface.BOLD);
        content.addView(metaView, matchWrap());

        meaningView = text("", Color.rgb(24, 34, 52), 20, Typeface.BOLD);
        meaningView.setGravity(Gravity.CENTER);
        meaningView.setPadding(dp(20), dp(18), dp(20), dp(18));
        meaningView.setBackground(rounded(Color.argb(238, 255, 255, 255), dp(24)));
        meaningView.setOnClickListener(v -> toggleMeaning());
        LinearLayout.LayoutParams meaningParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        meaningParams.setMargins(0, dp(24), 0, dp(8));
        content.addView(meaningView, meaningParams);

        TextView meaningHint = text("뜻을 누르면 영어 뜻으로 바뀝니다", Color.argb(205, 255, 255, 255), 13, Typeface.NORMAL);
        meaningHint.setPadding(0, dp(3), 0, 0);
        content.addView(meaningHint, matchWrap());

        View spacerBottom = new View(this);
        content.addView(spacerBottom, new LinearLayout.LayoutParams(1, 0, 1f));

        content.addView(bottomActions(), matchWrap());

        root.addView(content, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        return root;
    }

    private void handleSwipeGesture(MotionEvent event) {
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                swipeStartX = event.getRawX();
                swipeStartY = event.getRawY();
                if (velocityTracker == null) {
                    velocityTracker = VelocityTracker.obtain();
                } else {
                    velocityTracker.clear();
                }
                velocityTracker.addMovement(event);
                break;
            case MotionEvent.ACTION_MOVE:
                if (velocityTracker != null) velocityTracker.addMovement(event);
                float dx = event.getRawX() - swipeStartX;
                float dy = event.getRawY() - swipeStartY;
                // 좌우 힌트 강조
                if (Math.abs(dx) > Math.abs(dy)) {
                    float ratio = Math.min(1f, Math.abs(dx) / dp(SWIPE_THRESHOLD_DP));
                    if (unlockHint != null && quizHint != null) {
                        if (dx < 0) { // 좌 스와이프 → 잠금해제
                            unlockHint.setAlpha(0.5f + 0.5f * ratio);
                            quizHint.setAlpha(0.5f);
                        } else { // 우 스와이프 → 퀴즈
                            quizHint.setAlpha(0.5f + 0.5f * ratio);
                            unlockHint.setAlpha(0.5f);
                        }
                    }
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (unlockHint != null) unlockHint.setAlpha(0.85f);
                if (quizHint != null) quizHint.setAlpha(0.85f);
                if (velocityTracker != null) {
                    velocityTracker.addMovement(event);
                    velocityTracker.computeCurrentVelocity(1000);
                    float velX = velocityTracker.getXVelocity();
                    velocityTracker.recycle();
                    velocityTracker = null;

                    float distX = event.getRawX() - swipeStartX;
                    float distY = event.getRawY() - swipeStartY;
                    float threshPx = dp(SWIPE_THRESHOLD_DP);
                    float velThreshPx = dp(SWIPE_VELOCITY_DP);

                    if (Math.abs(distX) > Math.abs(distY) * 1.5f) {
                        if (distX < -threshPx || velX < -velThreshPx) {
                            // 좌 스와이프 → 잠금해제
                            finish();
                        } else if (distX > threshPx || velX > velThreshPx) {
                            // 우 스와이프 → 퀴즈
                            openQuiz();
                        }
                    }
                }
                break;
        }
    }

    private View bottomActions() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setGravity(Gravity.CENTER_HORIZONTAL);

        // 슬라이드 힌트 라벨 (← 잠금해제 · 퀴즈 →)
        LinearLayout hintRow = new LinearLayout(this);
        hintRow.setOrientation(LinearLayout.HORIZONTAL);
        hintRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams hintRowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        hintRowParams.setMargins(0, 0, 0, dp(14));
        hintRow.setLayoutParams(hintRowParams);

        unlockHint = text("← 잠금해제", Color.argb(217, 255, 255, 255), 14, Typeface.BOLD);
        unlockHint.setAlpha(0.85f);
        unlockHint.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        unlockHint.setOnClickListener(v -> finish());
        hintRow.addView(unlockHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView dot = text("·", Color.argb(140, 255, 255, 255), 16, Typeface.NORMAL);
        hintRow.addView(dot, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        quizHint = text("퀴즈 →", Color.argb(217, 255, 255, 255), 14, Typeface.BOLD);
        quizHint.setAlpha(0.85f);
        quizHint.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        quizHint.setOnClickListener(v -> openQuiz());
        hintRow.addView(quizHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        shell.addView(hintRow, matchWrap());

        // 슬라이드 바 (좌=잠금해제 / 우=퀴즈)
        LinearLayout slide = new LinearLayout(this);
        slide.setOrientation(LinearLayout.HORIZONTAL);
        slide.setPadding(dp(5), dp(5), dp(5), dp(5));
        slide.setBackground(pill(Color.argb(48, 255, 255, 255), Color.argb(62, 255, 255, 255)));

        TextView unlock = action("← 잠금 열기", Color.WHITE, Color.argb(42, 255, 255, 255));
        unlock.setOnClickListener(v -> finish());
        slide.addView(unlock, new LinearLayout.LayoutParams(0, dp(56), 1));

        TextView quiz = action("문제 풀기 →", Color.rgb(18, 34, 59), Color.WHITE);
        quiz.setOnClickListener(v -> openQuiz());
        LinearLayout.LayoutParams quizParams = new LinearLayout.LayoutParams(0, dp(56), 1);
        quizParams.setMargins(dp(6), 0, 0, 0);
        slide.addView(quiz, quizParams);
        shell.addView(slide, matchWrap());

        // 단축키 (전화, 카메라)
        LinearLayout shortcuts = new LinearLayout(this);
        shortcuts.setGravity(Gravity.CENTER);
        shortcuts.setPadding(0, dp(18), 0, 0);

        TextView phone = shortcut("☎");
        phone.setContentDescription("전화");
        phone.setOnClickListener(v -> openPhone());
        shortcuts.addView(phone, new LinearLayout.LayoutParams(dp(58), dp(58)));

        TextView label = text("← 스와이프로 이동 →", Color.argb(170, 255, 255, 255), 12, Typeface.BOLD);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        labelParams.setMargins(dp(12), 0, dp(12), 0);
        shortcuts.addView(label, labelParams);

        TextView camera = shortcut("▣");
        camera.setContentDescription("카메라");
        camera.setOnClickListener(v -> openCamera());
        shortcuts.addView(camera, new LinearLayout.LayoutParams(dp(58), dp(58)));
        shell.addView(shortcuts, matchWrap());

        return shell;
    }

    private void updateClock() {
        Calendar now = Calendar.getInstance();
        timeView.setText(new SimpleDateFormat("HH:mm", Locale.KOREAN).format(now.getTime()));
        dateView.setText(new SimpleDateFormat("M월 d일 EEEE", Locale.KOREAN).format(now.getTime()));
    }

    private void moveWord(int delta) {
        if (todayWords.isEmpty()) {
            return;
        }
        wordIndex = (wordIndex + delta + todayWords.size()) % todayWords.size();
        showingEnglishMeaning = false;
        updateWord();
    }

    private void toggleMeaning() {
        showingEnglishMeaning = !showingEnglishMeaning;
        updateMeaning();
    }

    private void updateWord() {
        WordEntry entry = currentWord();
        wordView.setText(entry.word);
        metaView.setText(entry.part + " · Unit " + entry.unit);
        counterView.setText("오늘의 Unit " + todayUnit + " · " + (wordIndex + 1) + " / " + todayWords.size());
        updateMeaning();
    }

    private void updateMeaning() {
        WordEntry entry = currentWord();
        meaningView.setText(showingEnglishMeaning ? entry.english : entry.korean);
    }

    private WordEntry currentWord() {
        if (todayWords.isEmpty()) {
            return new WordEntry("benefit", "n.", 1, "이익, 혜택", "a good thing");
        }
        return todayWords.get(wordIndex);
    }

    private void openQuiz() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.putExtra(MainActivity.EXTRA_ROUTE, "quiz");
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(launch);
        finish();
    }

    private void openPhone() {
        startShortcut(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:")));
    }

    private void openCamera() {
        startShortcut(new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA));
    }

    private void startShortcut(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            finish();
        } catch (Exception ignored) {
        }
    }

    private void loadTodayWords() {
        List<WordEntry> allWords = new ArrayList<>();
        try {
            InputStream input = getAssets().open("www/data/words.json");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            JSONArray words = new JSONArray(output.toString(StandardCharsets.UTF_8.name()));
            for (int i = 0; i < words.length(); i++) {
                JSONObject word = words.getJSONObject(i);
                WordEntry entry = new WordEntry(
                        word.optString("word", "benefit"),
                        word.optString("part", "n."),
                        word.optInt("unit", 1),
                        word.optString("korean", "이익, 혜택"),
                        word.optString("english", "a good thing")
                );
                maxUnit = Math.max(maxUnit, entry.unit);
                allWords.add(entry);
            }
        } catch (Exception ignored) {
            allWords.add(new WordEntry("benefit", "n.", 1, "이익, 혜택", "a good thing"));
        }

        todayUnit = unitForToday();
        for (WordEntry entry : allWords) {
            if (entry.unit == todayUnit) {
                todayWords.add(entry);
            }
        }
        if (todayWords.isEmpty()) {
            todayWords.addAll(allWords);
            todayUnit = currentWord().unit;
        }
    }

    private int unitForToday() {
        Calendar start = Calendar.getInstance();
        start.set(2026, Calendar.MAY, 5, 0, 0, 0);
        start.set(Calendar.MILLISECOND, 0);

        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);

        long dayOffset = (today.getTimeInMillis() - start.getTimeInMillis()) / ONE_DAY_MS;
        return (int) Math.floorMod(dayOffset, maxUnit) + 1;
    }

    private GradientDrawable lockBackground() {
        return new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{
                        Color.rgb(17, 32, 50),
                        Color.rgb(31, 66, 88),
                        Color.rgb(16, 24, 39)
                }
        );
    }

    private GradientDrawable rounded(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private GradientDrawable pill(int color, int strokeColor) {
        GradientDrawable drawable = rounded(color, dp(999));
        drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }

    private TextView action(String value, int textColor, int bgColor) {
        TextView view = text(value, textColor, 15, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setBackground(rounded(bgColor, dp(999)));
        return view;
    }

    private TextView roundIcon(String value, float size) {
        TextView view = text(value, Color.WHITE, size, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setBackground(pill(Color.argb(42, 255, 255, 255), Color.argb(55, 255, 255, 255)));
        return view;
    }

    private TextView shortcut(String value) {
        TextView view = text(value, Color.WHITE, 25, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setBackground(pill(Color.argb(38, 255, 255, 255), Color.argb(60, 255, 255, 255)));
        return view;
    }

    private TextView text(String value, int color, float size, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setTypeface(Typeface.DEFAULT, style);
        view.setGravity(Gravity.CENTER);
        view.setLetterSpacing(0f);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private static class WordEntry {
        final String word;
        final String part;
        final int unit;
        final String korean;
        final String english;

        WordEntry(String word, String part, int unit, String korean, String english) {
            this.word = word;
            this.part = part;
            this.unit = unit;
            this.korean = korean;
            this.english = english;
        }
    }
}
