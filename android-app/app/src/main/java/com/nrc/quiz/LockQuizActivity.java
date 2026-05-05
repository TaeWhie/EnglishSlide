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
import android.util.TypedValue;
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

        // 전체 화면 스와이프 감지
        root.setOnTouchListener((v, event) -> {
            handleSwipeGesture(event);
            return true;
        });

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(24), dp(60), dp(24), dp(40));

        // 1. 시계 영역 (최신 스타일 - 크고 얇게)
        timeView = text("", Color.WHITE, 82, Typeface.NORMAL);
        timeView.setIncludeFontPadding(false);
        timeView.setAlpha(0.95f);
        content.addView(timeView, matchWrap());

        dateView = text("", Color.argb(200, 255, 255, 255), 18, Typeface.NORMAL);
        dateView.setPadding(0, dp(4), 0, 0);
        content.addView(dateView, matchWrap());

        // 상단 공간 확보
        View spacerTop = new View(this);
        content.addView(spacerTop, new LinearLayout.LayoutParams(1, 0, 1.2f));

        // 2. 단어 카드 영역 (Glassmorphism 적용)
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(24), dp(32), dp(24), dp(32));
        card.setBackground(rounded(Color.argb(35, 255, 255, 255), dp(32)));
        
        // 카드 테두리 (Stroke) 추가
        GradientDrawable cardBg = (GradientDrawable) card.getBackground();
        cardBg.setStroke(dp(1), Color.argb(50, 255, 255, 255));

        counterView = text("", Color.argb(200, 255, 255, 255), 13, Typeface.BOLD);
        counterView.setPadding(dp(12), dp(4), dp(12), dp(4));
        counterView.setBackground(pill(Color.argb(30, 255, 255, 255), Color.argb(0, 0, 0, 0)));
        card.addView(counterView, wrapWrap());

        LinearLayout wordRow = new LinearLayout(this);
        wordRow.setGravity(Gravity.CENTER);
        wordRow.setOrientation(LinearLayout.HORIZONTAL);
        wordRow.setPadding(0, dp(20), 0, dp(8));

        TextView prev = roundIcon("‹", 28);
        prev.setOnClickListener(v -> moveWord(-1));
        wordRow.addView(prev, new LinearLayout.LayoutParams(dp(44), dp(44)));

        wordView = text("", Color.WHITE, 48, Typeface.BOLD);
        wordView.setPadding(dp(16), 0, dp(16), 0);
        wordView.setSingleLine(true);
        wordView.setGravity(Gravity.CENTER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            wordView.setAutoSizeTextTypeUniformWithConfiguration(
                12, 48, 2, TypedValue.COMPLEX_UNIT_SP
            );
        }
        wordRow.addView(wordView, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView next = roundIcon("›", 28);
        next.setOnClickListener(v -> moveWord(1));
        wordRow.addView(next, new LinearLayout.LayoutParams(dp(44), dp(44)));
        card.addView(wordRow, matchWrap());

        metaView = text("", Color.argb(180, 255, 255, 255), 16, Typeface.NORMAL);
        card.addView(metaView, matchWrap());

        meaningView = text("", Color.rgb(255, 255, 255), 22, Typeface.BOLD);
        meaningView.setGravity(Gravity.CENTER);
        meaningView.setPadding(dp(16), dp(16), dp(16), dp(16));
        meaningView.setBackground(rounded(Color.argb(40, 255, 255, 255), dp(16)));
        meaningView.setOnClickListener(v -> toggleMeaning());
        LinearLayout.LayoutParams meaningParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        meaningParams.setMargins(0, dp(24), 0, 0);
        card.addView(meaningView, meaningParams);

        TextView meaningHint = text("터치하여 뜻 확인", Color.argb(140, 255, 255, 255), 12, Typeface.NORMAL);
        meaningHint.setPadding(0, dp(8), 0, 0);
        card.addView(meaningHint, matchWrap());

        content.addView(card, matchWrap());

        // 하단 공간 확보
        View spacerBottom = new View(this);
        content.addView(spacerBottom, new LinearLayout.LayoutParams(1, 0, 1f));

        // 3. 하단 슬라이드 힌트 영역
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
                if (Math.abs(dx) > Math.abs(dy)) {
                    float ratio = Math.min(1f, Math.abs(dx) / dp(SWIPE_THRESHOLD_DP));
                    if (unlockHint != null && quizHint != null) {
                        if (dx < 0) { // 좌 스와이프
                            unlockHint.setAlpha(0.6f + 0.4f * ratio);
                            unlockHint.setScaleX(1.0f + 0.1f * ratio);
                            unlockHint.setScaleY(1.0f + 0.1f * ratio);
                            quizHint.setAlpha(0.4f);
                        } else { // 우 스와이프
                            quizHint.setAlpha(0.6f + 0.4f * ratio);
                            quizHint.setScaleX(1.0f + 0.1f * ratio);
                            quizHint.setScaleY(1.0f + 0.1f * ratio);
                            unlockHint.setAlpha(0.4f);
                        }
                    }
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (unlockHint != null) {
                    unlockHint.setAlpha(0.7f);
                    unlockHint.setScaleX(1.0f);
                    unlockHint.setScaleY(1.0f);
                }
                if (quizHint != null) {
                    quizHint.setAlpha(0.7f);
                    quizHint.setScaleX(1.0f);
                    quizHint.setScaleY(1.0f);
                }
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
                            performUnlock();
                        } else if (distX > threshPx || velX > velThreshPx) {
                            performOpenQuiz();
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

        // 통합 슬라이드 힌트 바
        LinearLayout slideBar = new LinearLayout(this);
        slideBar.setOrientation(LinearLayout.HORIZONTAL);
        slideBar.setGravity(Gravity.CENTER_VERTICAL);
        slideBar.setPadding(dp(20), dp(16), dp(20), dp(16));
        slideBar.setBackground(pill(Color.argb(40, 255, 255, 255), Color.argb(60, 255, 255, 255)));

        unlockHint = text("‹  잠금해제", Color.WHITE, 15, Typeface.BOLD);
        unlockHint.setAlpha(0.7f);
        slideBar.addView(unlockHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView centerIcon = text("●", Color.WHITE, 12, Typeface.NORMAL);
        centerIcon.setAlpha(0.5f);
        slideBar.addView(centerIcon, wrapWrap());

        quizHint = text("퀴즈풀기  ›", Color.WHITE, 15, Typeface.BOLD);
        quizHint.setAlpha(0.7f);
        quizHint.setGravity(Gravity.END);
        slideBar.addView(quizHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        shell.addView(slideBar, new LinearLayout.LayoutParams(dp(280), LinearLayout.LayoutParams.WRAP_CONTENT));

        // 단축키 영역 (심플하게)
        LinearLayout shortcuts = new LinearLayout(this);
        shortcuts.setGravity(Gravity.CENTER);
        shortcuts.setPadding(0, dp(24), 0, 0);

        TextView phone = shortcut("📞");
        phone.setOnClickListener(v -> openPhone());
        shortcuts.addView(phone, new LinearLayout.LayoutParams(dp(54), dp(54)));

        View space = new View(this);
        shortcuts.addView(space, new LinearLayout.LayoutParams(dp(40), 1));

        TextView camera = shortcut("📷");
        camera.setOnClickListener(v -> openCamera());
        shortcuts.addView(camera, new LinearLayout.LayoutParams(dp(54), dp(54)));

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

    private void unlockAndRun(Runnable onSuccess) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (keyguardManager != null && keyguardManager.isKeyguardLocked()) {
                keyguardManager.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                    @Override
                    public void onDismissSucceeded() {
                        if (onSuccess != null) onSuccess.run();
                    }
                    @Override
                    public void onDismissCancelled() {
                        // Stay on lock screen
                    }
                    @Override
                    public void onDismissError() {
                        // Stay on lock screen
                    }
                });
            } else {
                if (onSuccess != null) onSuccess.run();
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
            if (onSuccess != null) onSuccess.run();
        }
    }

    private void performUnlock() {
        unlockAndRun(this::finish);
    }

    private void performOpenQuiz() {
        unlockAndRun(() -> {
            Intent launch = new Intent(this, MainActivity.class);
            launch.putExtra(MainActivity.EXTRA_ROUTE, "quiz");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(launch);
            finish();
        });
    }

    private void openPhone() {
        unlockAndRun(() -> startShortcut(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:"))));
    }

    private void openCamera() {
        unlockAndRun(() -> startShortcut(new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)));
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
