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
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.ViewTreeObserver;
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
    public static final String EXTRA_ACTION = "com.nrc.quiz.EXTRA_LOCK_ACTION";
    public static final String ACTION_UNLOCK = "unlock";
    public static final String ACTION_OPEN_QUIZ = "open_quiz";
    private static final long ONE_DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long DEFAULT_IDLE_TIMEOUT_MS = 30_000L;
    private static final long MIN_IDLE_TIMEOUT_MS = 1_000L;
    private static final float SWIPE_THRESHOLD_DP = 84f;
    private static final float SWIPE_VELOCITY_DP = 420f;

    private final Handler clockHandler = new Handler(Looper.getMainLooper());
    private final List<WordEntry> todayWords = new ArrayList<>();
    private int wordIndex = 0;
    private int todayUnit = 1;
    private int maxUnit = 1;
    private boolean showingEnglishMeaning = false;
    private int wordsLoadToken = 0;

    private TextView timeView;
    private TextView dateView;
    private TextView wordView;
    private TextView metaView;
    private TextView meaningView;
    private TextView counterView;
    private TextView unlockHint;
    private TextView quizHint;
    private TextView rewardHint;
    private LinearLayout contentLayout;
    private LinearLayout bottomActionsLayout;

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

    private final Runnable idleTimeout = new Runnable() {
        @Override
        public void run() {
            handleIdleTimeout();
        }
    };

    private final Runnable immersiveRefresh = new Runnable() {
        @Override
        public void run() {
            applyImmersiveMode();
        }
    };

    private final ViewTreeObserver.OnGlobalLayoutListener immersiveLayoutListener =
            new ViewTreeObserver.OnGlobalLayoutListener() {
                @Override
                public void onGlobalLayout() {
                    clockHandler.removeCallbacks(immersiveRefresh);
                    clockHandler.post(immersiveRefresh);
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureLockWindow();
        overridePendingTransition(0, 0);

        if (!isEnabled() || !isDeviceLocked()) {
            finish();
            return;
        }

        String requestedAction = getIntent().getStringExtra(EXTRA_ACTION);
        if (ACTION_UNLOCK.equals(requestedAction)) {
            performUnlock();
            return;
        }
        if (ACTION_OPEN_QUIZ.equals(requestedAction)) {
            performOpenQuiz();
            return;
        }

        setContentView(buildContent());
        View decorView = getWindow().getDecorView();
        decorView.setOnSystemUiVisibilityChangeListener(visibility -> {
            if ((visibility & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0) {
                clockHandler.removeCallbacks(immersiveRefresh);
                clockHandler.post(immersiveRefresh);
            }
        });
        decorView.setOnApplyWindowInsetsListener((v, insets) -> {
            clockHandler.removeCallbacks(immersiveRefresh);
            clockHandler.post(immersiveRefresh);
            return v.onApplyWindowInsets(insets);
        });
        decorView.getViewTreeObserver().addOnGlobalLayoutListener(immersiveLayoutListener);
        updateWord();
        loadTodayWordsAsync();
        clockTick.run();
        scheduleIdleTimeout();
        clockHandler.post(immersiveRefresh);
        clockHandler.postDelayed(immersiveRefresh, 16L);
        clockHandler.postDelayed(immersiveRefresh, 32L);
        clockHandler.postDelayed(immersiveRefresh, 80L);
        clockHandler.postDelayed(immersiveRefresh, 160L);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
        scheduleIdleTimeout();
        clockHandler.post(immersiveRefresh);
        clockHandler.postDelayed(immersiveRefresh, 16L);
        clockHandler.postDelayed(immersiveRefresh, 32L);
        clockHandler.postDelayed(immersiveRefresh, 80L);
        clockHandler.postDelayed(immersiveRefresh, 160L);
        if (!isEnabled() || !isDeviceLocked()) {
            finish();
        }
    }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
    }

    @Override
    protected void onPostResume() {
        super.onPostResume();
    }

    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        scheduleIdleTimeout();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
    }

    @Override
    protected void onDestroy() {
        clockHandler.removeCallbacks(clockTick);
        clockHandler.removeCallbacks(idleTimeout);
        clockHandler.removeCallbacks(immersiveRefresh);
        View decorView = getWindow().getDecorView();
        if (decorView != null) {
            decorView.setOnSystemUiVisibilityChangeListener(null);
            decorView.setOnApplyWindowInsetsListener(null);
            if (decorView.getViewTreeObserver().isAlive()) {
                decorView.getViewTreeObserver().removeOnGlobalLayoutListener(immersiveLayoutListener);
            }
        }
        if (velocityTracker != null) {
            velocityTracker.recycle();
            velocityTracker = null;
        }
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
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.setWindowAnimations(0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
        }
        window.setBackgroundDrawable(lockBackground());
    }

    private void applyImmersiveMode() {
        // Intentionally left blank: keep system navigation visible.
    }

    private boolean isEnabled() {
        SharedPreferences prefs = getSharedPreferences(LockQuizOverlayService.PREFS, MODE_PRIVATE);
        return prefs.getBoolean(LockQuizOverlayService.KEY_ENABLED, LockQuizOverlayService.DEFAULT_ENABLED);
    }

    private boolean shouldShowRewardPrompt() {
        SharedPreferences prefs = getSharedPreferences(LockQuizOverlayService.PREFS, MODE_PRIVATE);
        return prefs.getBoolean(
                LockQuizOverlayService.KEY_REWARD_PROMPT,
                LockQuizOverlayService.DEFAULT_REWARD_PROMPT
        );
    }

    private boolean isDeviceLocked() {
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        return keyguardManager != null && keyguardManager.isKeyguardLocked();
    }

    private View buildContent() {
        FrameLayout root = new FrameLayout(this);
        root.setBackground(lockBackground());
        root.setOnTouchListener((v, event) -> {
            handleSwipeGesture(event);
            return true;
        });

        contentLayout = new LinearLayout(this);
        contentLayout.setOrientation(LinearLayout.VERTICAL);
        contentLayout.setGravity(Gravity.CENTER_HORIZONTAL);
        contentLayout.setPadding(dp(24), dp(54), dp(24), dp(34));

        timeView = text("", Color.WHITE, 76, Typeface.NORMAL);
        timeView.setIncludeFontPadding(false);
        contentLayout.addView(timeView, matchWrap());

        dateView = text("", Color.argb(210, 255, 255, 255), 17, Typeface.NORMAL);
        contentLayout.addView(dateView, matchWrap());

        View spacerTop = new View(this);
        contentLayout.addView(spacerTop, new LinearLayout.LayoutParams(1, 0, 1.05f));

        contentLayout.addView(wordCard(), matchWrap());

        View spacerBottom = new View(this);
        contentLayout.addView(spacerBottom, new LinearLayout.LayoutParams(1, 0, 0.82f));

        bottomActionsLayout = bottomActions();
        contentLayout.addView(bottomActionsLayout, matchWrap());

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            applyContentInsets(insets);
            clockHandler.removeCallbacks(immersiveRefresh);
            clockHandler.post(immersiveRefresh);
            return insets;
        });

        root.addView(contentLayout, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        return root;
    }

    private void applyContentInsets(WindowInsets insets) {
        if (contentLayout == null || insets == null) {
            return;
        }
        int topInset = 0;
        int bottomInset = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            topInset = bars.top;
            bottomInset = bars.bottom;
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            topInset = insets.getSystemWindowInsetTop();
            bottomInset = insets.getSystemWindowInsetBottom();
        }

        contentLayout.setPadding(
                dp(24),
                dp(36) + topInset,
                dp(24),
                dp(18) + bottomInset
        );

        if (bottomActionsLayout != null) {
            bottomActionsLayout.setPadding(
                    0,
                    0,
                    0,
                    Math.max(dp(12), bottomInset)
            );
        }
    }

    private View wordCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(22), dp(28), dp(22), dp(24));
        card.setBackground(pillish(Color.argb(42, 255, 255, 255), dp(24), Color.argb(52, 255, 255, 255)));

        counterView = text("", Color.argb(210, 255, 255, 255), 13, Typeface.BOLD);
        counterView.setPadding(dp(12), dp(5), dp(12), dp(5));
        counterView.setBackground(pill(Color.argb(34, 255, 255, 255), Color.TRANSPARENT));
        card.addView(counterView, wrapWrap());

        LinearLayout wordRow = new LinearLayout(this);
        wordRow.setGravity(Gravity.CENTER);
        wordRow.setOrientation(LinearLayout.HORIZONTAL);
        wordRow.setPadding(0, dp(18), 0, dp(8));

        TextView prev = roundIcon("<", 25);
        prev.setOnClickListener(v -> moveWord(-1));
        wordRow.addView(prev, new LinearLayout.LayoutParams(dp(42), dp(42)));

        wordView = text("", Color.WHITE, 46, Typeface.BOLD);
        wordView.setPadding(dp(10), 0, dp(10), 0);
        wordView.setMaxLines(1);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            wordView.setAutoSizeTextTypeUniformWithConfiguration(16, 46, 1, TypedValue.COMPLEX_UNIT_SP);
        }
        wordRow.addView(wordView, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView next = roundIcon(">", 25);
        next.setOnClickListener(v -> moveWord(1));
        wordRow.addView(next, new LinearLayout.LayoutParams(dp(42), dp(42)));

        card.addView(wordRow, matchWrap());

        metaView = text("", Color.argb(180, 255, 255, 255), 15, Typeface.NORMAL);
        card.addView(metaView, matchWrap());

        meaningView = text("", Color.WHITE, 21, Typeface.BOLD);
        meaningView.setGravity(Gravity.CENTER);
        meaningView.setPadding(dp(16), dp(16), dp(16), dp(16));
        meaningView.setBackground(pillish(Color.argb(42, 255, 255, 255), dp(16), Color.argb(38, 255, 255, 255)));
        meaningView.setOnClickListener(v -> toggleMeaning());
        LinearLayout.LayoutParams meaningParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        meaningParams.setMargins(0, dp(22), 0, 0);
        card.addView(meaningView, meaningParams);

        TextView meaningHint = text("Tap meaning to switch Korean / English", Color.argb(145, 255, 255, 255), 12, Typeface.NORMAL);
        meaningHint.setPadding(0, dp(8), 0, 0);
        card.addView(meaningHint, matchWrap());

        return card;
    }

    private void handleSwipeGesture(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                scheduleIdleTimeout();
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
                scheduleIdleTimeout();
                if (velocityTracker != null) velocityTracker.addMovement(event);
                updateSwipeHints(event.getRawX() - swipeStartX, event.getRawY() - swipeStartY);
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                scheduleIdleTimeout();
                finishSwipe(event);
                break;
            default:
                break;
        }
    }

    private void updateSwipeHints(float dx, float dy) {
        if (Math.abs(dx) <= Math.abs(dy) || unlockHint == null || quizHint == null) return;

        float ratio = Math.min(1f, Math.abs(dx) / dp(SWIPE_THRESHOLD_DP));
        TextView active = dx < 0 ? unlockHint : quizHint;
        TextView inactive = dx < 0 ? quizHint : unlockHint;
        active.setAlpha(0.62f + 0.38f * ratio);
        active.setScaleX(1.0f + 0.08f * ratio);
        active.setScaleY(1.0f + 0.08f * ratio);
        inactive.setAlpha(0.42f);
        inactive.setScaleX(1.0f);
        inactive.setScaleY(1.0f);
    }

    private void finishSwipe(MotionEvent event) {
        resetSwipeHints();
        if (velocityTracker == null) return;

        velocityTracker.addMovement(event);
        velocityTracker.computeCurrentVelocity(1000);
        float velocityX = velocityTracker.getXVelocity();
        velocityTracker.recycle();
        velocityTracker = null;

        float distanceX = event.getRawX() - swipeStartX;
        float distanceY = event.getRawY() - swipeStartY;
        if (Math.abs(distanceX) <= Math.abs(distanceY) * 1.5f) return;

        if (distanceX < -dp(SWIPE_THRESHOLD_DP) || velocityX < -dp(SWIPE_VELOCITY_DP)) {
            performUnlock();
        } else if (distanceX > dp(SWIPE_THRESHOLD_DP) || velocityX > dp(SWIPE_VELOCITY_DP)) {
            performOpenQuiz();
        }
    }

    private void resetSwipeHints() {
        if (unlockHint != null) {
            unlockHint.setAlpha(0.74f);
            unlockHint.setScaleX(1.0f);
            unlockHint.setScaleY(1.0f);
        }
        if (quizHint != null) {
            quizHint.setAlpha(0.74f);
            quizHint.setScaleX(1.0f);
            quizHint.setScaleY(1.0f);
        }
    }

    private LinearLayout bottomActions() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setGravity(Gravity.CENTER_HORIZONTAL);
        shell.setPadding(0, 0, 0, dp(4));

        LinearLayout slideBar = new LinearLayout(this);
        slideBar.setOrientation(LinearLayout.HORIZONTAL);
        slideBar.setGravity(Gravity.CENTER_VERTICAL);
        slideBar.setPadding(dp(18), dp(14), dp(18), dp(14));
        slideBar.setBackground(pill(Color.argb(38, 255, 255, 255), Color.argb(54, 255, 255, 255)));

        unlockHint = text("Unlock", Color.WHITE, 15, Typeface.BOLD);
        unlockHint.setAlpha(0.74f);
        unlockHint.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        slideBar.addView(unlockHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView centerIcon = text("|", Color.argb(130, 255, 255, 255), 13, Typeface.BOLD);
        centerIcon.setPadding(dp(10), 0, dp(10), 0);
        slideBar.addView(centerIcon, wrapWrap());

        quizHint = text("Quiz", Color.WHITE, 15, Typeface.BOLD);
        quizHint.setAlpha(0.74f);
        quizHint.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        slideBar.addView(quizHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        shell.addView(slideBar, new LinearLayout.LayoutParams(dp(286), LinearLayout.LayoutParams.WRAP_CONTENT));

        rewardHint = text("", Color.argb(170, 255, 255, 255), 12, Typeface.NORMAL);
        rewardHint.setPadding(0, dp(10), 0, 0);
        rewardHint.setText(shouldShowRewardPrompt() ? "Unlock after one quick word review." : "Word review is active.");
        shell.addView(rewardHint, matchWrap());

        LinearLayout shortcuts = new LinearLayout(this);
        shortcuts.setGravity(Gravity.CENTER_VERTICAL);
        shortcuts.setPadding(0, dp(22), 0, 0);
        shortcuts.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        TextView phone = shortcut("Tel");
        phone.setOnClickListener(v -> openPhone());
        shortcuts.addView(phone, new LinearLayout.LayoutParams(dp(56), dp(56)));

        View space = new View(this);
        shortcuts.addView(space, new LinearLayout.LayoutParams(0, 1, 1f));

        TextView camera = shortcut("Cam");
        camera.setOnClickListener(v -> openCamera());
        shortcuts.addView(camera, new LinearLayout.LayoutParams(dp(56), dp(56)));

        shell.addView(shortcuts, matchWrap());
        return shell;
    }

    private void updateClock() {
        Calendar now = Calendar.getInstance();
        timeView.setText(new SimpleDateFormat("HH:mm", Locale.KOREAN).format(now.getTime()));
        dateView.setText(new SimpleDateFormat("EEE, MMM d", Locale.KOREAN).format(now.getTime()));
    }

    private void moveWord(int delta) {
        if (todayWords.isEmpty()) return;
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
        metaView.setText(entry.part + " - Unit " + entry.unit);
        counterView.setText("Today Unit " + todayUnit + " - " + (wordIndex + 1) + " / " + todayWords.size());
        updateMeaning();
    }

    private void updateMeaning() {
        WordEntry entry = currentWord();
        meaningView.setText(showingEnglishMeaning ? entry.english : entry.korean);
    }

    private WordEntry currentWord() {
        if (todayWords.isEmpty()) {
            return new WordEntry("benefit", "n.", 1, "advantage; profit", "a good or helpful result");
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
                });
                return;
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        if (onSuccess != null) onSuccess.run();
    }

    private void performUnlock() {
        LockQuizOverlayService.suppressUntilNextScreenOff();
        unlockAndRun(() -> {
            finish();
            overridePendingTransition(0, 0);
        });
    }

    private void performOpenQuiz() {
        LockQuizOverlayService.suppressUntilNextScreenOff();
        unlockAndRun(() -> {
            Intent launch = new Intent(this, MainActivity.class);
            launch.putExtra(MainActivity.EXTRA_ROUTE, "quiz");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(launch);
            finish();
            overridePendingTransition(0, 0);
        });
    }

    private void openPhone() {
        LockQuizOverlayService.suppressUntilNextScreenOff();
        unlockAndRun(() -> startShortcut(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:"))));
    }

    private void openCamera() {
        LockQuizOverlayService.suppressUntilNextScreenOff();
        unlockAndRun(() -> startShortcut(new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)));
    }

    private void startShortcut(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            finish();
            overridePendingTransition(0, 0);
        } catch (Exception ignored) {
        }
    }

    private void scheduleIdleTimeout() {
        clockHandler.removeCallbacks(idleTimeout);
        clockHandler.postDelayed(idleTimeout, resolveIdleTimeoutMs());
    }

    private long resolveIdleTimeoutMs() {
        try {
            int systemTimeout = Settings.System.getInt(
                    getContentResolver(),
                    Settings.System.SCREEN_OFF_TIMEOUT
            );
            return Math.max(MIN_IDLE_TIMEOUT_MS, systemTimeout);
        } catch (Exception ignored) {
            return DEFAULT_IDLE_TIMEOUT_MS;
        }
    }

    private void handleIdleTimeout() {
        if (isFinishing()) return;
        LockQuizOverlayService.suppressUntilNextScreenOff();

        boolean slept = false;
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                PowerManager.class
                        .getMethod("goToSleep", long.class)
                        .invoke(powerManager, SystemClock.uptimeMillis());
                slept = true;
            }
        } catch (Exception ignored) {
        }

        if (!slept) {
            finish();
            overridePendingTransition(0, 0);
        }
    }

    private void loadTodayWordsAsync() {
        final int loadToken = ++wordsLoadToken;
        new Thread(() -> {
            WordLoadResult result = buildTodayWords();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyedCompat() || loadToken != wordsLoadToken) {
                    return;
                }
                todayWords.clear();
                todayWords.addAll(result.words);
                todayUnit = result.todayUnit;
                maxUnit = result.maxUnit;
                if (wordIndex >= todayWords.size()) {
                    wordIndex = 0;
                }
                showingEnglishMeaning = false;
                updateWord();
            });
        }, "lock-words-loader").start();
    }

    private WordLoadResult buildTodayWords() {
        List<WordEntry> allWords = new ArrayList<>();
        int resolvedMaxUnit = 1;
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
                        word.optString("korean", "advantage; profit"),
                        word.optString("english", "a good or helpful result")
                );
                resolvedMaxUnit = Math.max(resolvedMaxUnit, entry.unit);
                allWords.add(entry);
            }
        } catch (Exception ignored) {
            allWords.add(currentWord());
        }

        int resolvedTodayUnit = unitForToday(resolvedMaxUnit);
        List<WordEntry> resolvedTodayWords = new ArrayList<>();
        for (WordEntry entry : allWords) {
            if (entry.unit == resolvedTodayUnit) {
                resolvedTodayWords.add(entry);
            }
        }
        if (resolvedTodayWords.isEmpty()) {
            resolvedTodayWords.addAll(allWords);
            if (!resolvedTodayWords.isEmpty()) {
                resolvedTodayUnit = resolvedTodayWords.get(0).unit;
            }
        }
        return new WordLoadResult(resolvedTodayWords, resolvedTodayUnit, resolvedMaxUnit);
    }

    private int unitForToday(int cycleMaxUnit) {
        Calendar start = Calendar.getInstance();
        start.set(2026, Calendar.MAY, 5, 0, 0, 0);
        start.set(Calendar.MILLISECOND, 0);

        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);

        long dayOffset = (today.getTimeInMillis() - start.getTimeInMillis()) / ONE_DAY_MS;
        return (int) Math.floorMod(dayOffset, Math.max(1, cycleMaxUnit)) + 1;
    }

    private boolean isDestroyedCompat() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed();
    }

    private GradientDrawable lockBackground() {
        return new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{
                        Color.rgb(18, 31, 45),
                        Color.rgb(31, 69, 78),
                        Color.rgb(17, 24, 37)
                }
        );
    }

    private GradientDrawable rounded(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private GradientDrawable pillish(int color, float radius, int strokeColor) {
        GradientDrawable drawable = rounded(color, radius);
        drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }

    private GradientDrawable pill(int color, int strokeColor) {
        return pillish(color, dp(999), strokeColor);
    }

    private TextView roundIcon(String value, float size) {
        TextView view = text(value, Color.WHITE, size, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setBackground(pill(Color.argb(42, 255, 255, 255), Color.argb(55, 255, 255, 255)));
        return view;
    }

    private TextView shortcut(String value) {
        TextView view = text(value, Color.WHITE, 13, Typeface.BOLD);
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

    private static class WordLoadResult {
        final List<WordEntry> words;
        final int todayUnit;
        final int maxUnit;

        WordLoadResult(List<WordEntry> words, int todayUnit, int maxUnit) {
            this.words = words;
            this.todayUnit = todayUnit;
            this.maxUnit = maxUnit;
        }
    }
}
