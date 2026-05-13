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
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Random;

public class LockQuizOverlayService extends Service {
    public static final String ACTION_SYNC_SETTINGS = "com.nrc.quiz.SYNC_LOCKSCREEN_SETTINGS";
    static final String PREFS = "nrc_native_settings";
    static final String KEY_ENABLED = "lockscreen_enabled";
    static final String KEY_REWARD_PROMPT = "lockscreen_reward_prompt";
    static final boolean DEFAULT_ENABLED = true;
    static final boolean DEFAULT_REWARD_PROMPT = true;

    private static final String TAG = "LockQuizService";
    private static final String CHANNEL_ID = "lock_quiz_service";
    private static final int NOTIFICATION_ID = 41;
    private static final long ONE_DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long IDLE_TIMEOUT_MS = 8_000L;
    private static final float SWIPE_THRESHOLD_DP = 84f;
    private static final float SWIPE_VELOCITY_DP = 420f;
    private static volatile LockQuizOverlayService activeInstance;
    private static final long COVER_DISMISS_TIMEOUT_MS = 2200L;
    private static final int COLOR_CARD_TEXT = Color.rgb(24, 58, 78);
    private static final int COLOR_CARD_MUTED = Color.rgb(88, 120, 139);
    private static final int COLOR_CARD_SOFT = Color.rgb(110, 141, 160);
    private static final int COLOR_TEXT_PRIMARY = COLOR_CARD_TEXT;
    private static final int COLOR_TEXT_SECONDARY = Color.rgb(64, 97, 118);
    private static final int COLOR_TEXT_MUTED = Color.rgb(102, 132, 150);
    private static final int COLOR_PANEL = Color.argb(102, 255, 255, 255);
    private static final int COLOR_PANEL_STROKE = Color.argb(86, 184, 233, 241);
    private static final int LOCK_BANNER_WIDTH_DP = 236;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private KeyguardManager keyguardManager;
    private PowerManager powerManager;
    private WordLibrary.WordEntry currentNotificationWord;
    private WindowManager windowManager;
    private View overlayView;
    private View launchCoverView;
    private TextView overlayTimeView;
    private TextView overlayDateView;
    private TextView overlayWordView;
    private TextView overlayMetaView;
    private TextView overlayMeaningView;
    private TextView overlayUnlockHint;
    private TextView overlayQuizHint;
    private TextView overlayRewardHint;
    private AdView overlayBannerAdView;
    private VelocityTracker velocityTracker;
    private float swipeStartX = 0f;
    private float swipeStartY = 0f;
    private boolean showingEnglishMeaning = false;
    private boolean launchSuppressedUntilScreenOff = false;
    private int notificationWordLoadToken = 0;

    private final Runnable showLockQuizRunnable = new Runnable() {
        @Override
        public void run() {
            showLockQuizIfLocked();
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            Log.d(TAG, "Screen receiver action=" + action);
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                launchSuppressedUntilScreenOff = false;
                cancelPendingLockQuizLaunch();
                hideLaunchCover();
                prepareOverlayForWake();
                refreshNotification();
                return;
            }

            if (Intent.ACTION_USER_PRESENT.equals(action)) {
                launchSuppressedUntilScreenOff = true;
                cancelPendingLockQuizLaunch();
                hideOverlay();
                refreshNotification();
                return;
            }

            if (Intent.ACTION_SCREEN_ON.equals(action)) {
                hideLaunchCover();
                refreshNotification();
                scheduleLockQuizLaunch();
            }
        }
    };

    private final Runnable clockRefresh = new Runnable() {
        @Override
        public void run() {
            updateOverlayClock();
            mainHandler.postDelayed(this, 30_000L);
        }
    };

    private final Runnable idleTimeout = new Runnable() {
        @Override
        public void run() {
            hideOverlay();
        }
    };

    private final Runnable coverDismissTimeout = new Runnable() {
        @Override
        public void run() {
            hideLaunchCover();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        MobileAds.initialize(this, initializationStatus -> {
        });
        registerScreenReceiver();
        refreshNotification();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled()) {
            hideOverlay();
            stopSelf();
            return START_NOT_STICKY;
        }
        refreshNotification();
        if (isScreenInteractive() && isDeviceLocked()) {
            scheduleLockQuizLaunch();
        } else if (!isScreenInteractive()) {
            cancelPendingLockQuizLaunch();
            hideLaunchCover();
            prepareOverlayForWake();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        mainHandler.removeCallbacksAndMessages(null);
        hideOverlay();
        hideLaunchCover();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void registerScreenReceiver() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(screenReceiver, filter);
    }

    private boolean isEnabled() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getBoolean(KEY_ENABLED, DEFAULT_ENABLED);
    }

    private boolean isDeviceLocked() {
        return keyguardManager != null && keyguardManager.isKeyguardLocked();
    }

    private boolean isScreenInteractive() {
        return powerManager != null && powerManager.isInteractive();
    }

    private void scheduleLockQuizLaunch() {
        if (launchSuppressedUntilScreenOff) {
            return;
        }
        cancelPendingLockQuizLaunch();
        mainHandler.post(showLockQuizRunnable);
        mainHandler.postDelayed(showLockQuizRunnable, 120L);
        mainHandler.postDelayed(showLockQuizRunnable, 300L);
    }

    private void cancelPendingLockQuizLaunch() {
        mainHandler.removeCallbacks(showLockQuizRunnable);
    }

    private void showLockQuizIfLocked() {
        boolean locked = isDeviceLocked();
        boolean interactive = isScreenInteractive();
        Log.d(TAG, "showLockQuizIfLocked enabled=" + isEnabled() + " locked=" + locked + " interactive=" + interactive + " suppressed=" + launchSuppressedUntilScreenOff);
        if (!isEnabled() || launchSuppressedUntilScreenOff) return;
        if (!interactive || !locked) {
            hideLaunchCover();
            return;
        }
        hideOverlayForLaunch();
        hideLaunchCover();
        Intent lockQuiz = new Intent(this, LockQuizActivity.class);
        lockQuiz.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            startActivity(lockQuiz);
        } catch (RuntimeException error) {
            hideLaunchCover();
            Log.w(TAG, "Lock quiz launch was blocked by the system.", error);
        }
    }

    private void prepareOverlayForWake() {
        boolean locked = isDeviceLocked();
        boolean interactive = isScreenInteractive();
        Log.d(TAG, "prepareOverlayForWake enabled=" + isEnabled() + " locked=" + locked + " interactive=" + interactive + " canDraw=" + canShowOverlay() + " suppressed=" + launchSuppressedUntilScreenOff);
        if (!isEnabled() || !canShowOverlay() || launchSuppressedUntilScreenOff) return;
        if (interactive && !locked) return;
        if (overlayView != null) {
            updateOverlayContent();
            updateOverlayClock();
            if (interactive) {
                scheduleIdleTimeout();
            } else {
                mainHandler.removeCallbacks(idleTimeout);
            }
            return;
        }

        try {
            overlayView = buildOverlayView();
            windowManager.addView(overlayView, buildOverlayLayoutParams());
            Log.d(TAG, "Overlay lock quiz attached.");
            updateOverlayContent();
            updateOverlayClock();
            if (interactive) {
                scheduleIdleTimeout();
            } else {
                mainHandler.removeCallbacks(idleTimeout);
            }
            mainHandler.post(clockRefresh);
        } catch (RuntimeException error) {
            overlayView = null;
            Log.w(TAG, "Overlay lock quiz could not be shown.", error);
        }
    }

    private boolean canShowOverlay() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || android.provider.Settings.canDrawOverlays(this);
    }

    private WindowManager.LayoutParams buildOverlayLayoutParams() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_INSET_DECOR
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                flags,
                android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 0;
        params.y = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        return params;
    }

    private View buildOverlayView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(236, 224, 255));
        root.setClickable(true);
        root.setFocusable(true);
        root.setFitsSystemWindows(false);
        root.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
        root.setOnTouchListener((v, event) -> {
            handleSwipeGesture(event);
            return true;
        });

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(24), dp(82), dp(24), 0);

        overlayTimeView = text("", COLOR_TEXT_PRIMARY, 76, Typeface.NORMAL);
        overlayTimeView.setIncludeFontPadding(false);
        content.addView(overlayTimeView, matchWrap());

        overlayDateView = text("", COLOR_TEXT_SECONDARY, 17, Typeface.NORMAL);
        content.addView(overlayDateView, matchWrap());

        root.addView(content, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
        ));
        root.addView(buildOverlayWordCard(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
        ));
        root.addView(buildOverlayActions(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
        ));
        return root;
    }

    private View buildOverlayWordCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(22), dp(28), dp(22), dp(24));
        card.setBackground(pillish(Color.argb(166, 252, 254, 255), dp(24), Color.argb(220, 185, 225, 236)));

        overlayWordView = text("", COLOR_CARD_TEXT, 44, Typeface.BOLD);
        overlayWordView.setMaxLines(1);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            overlayWordView.setAutoSizeTextTypeUniformWithConfiguration(16, 44, 1, TypedValue.COMPLEX_UNIT_SP);
        }
        overlayWordView.setPadding(dp(10), 0, dp(10), dp(8));
        card.addView(overlayWordView, matchWrap());

        overlayMetaView = text("", COLOR_CARD_MUTED, 15, Typeface.NORMAL);
        card.addView(overlayMetaView, matchWrap());

        overlayMeaningView = text("", COLOR_CARD_TEXT, 20, Typeface.BOLD);
        overlayMeaningView.setGravity(Gravity.CENTER);
        overlayMeaningView.setPadding(dp(16), dp(16), dp(16), dp(16));
        overlayMeaningView.setBackground(pillish(Color.argb(160, 246, 253, 255), dp(16), Color.argb(220, 176, 226, 238)));
        overlayMeaningView.setOnClickListener(v -> {
            showingEnglishMeaning = !showingEnglishMeaning;
            updateOverlayMeaning();
            scheduleIdleTimeout();
        });
        LinearLayout.LayoutParams meaningParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        meaningParams.setMargins(0, dp(18), 0, 0);
        card.addView(overlayMeaningView, meaningParams);

        TextView hint = text("Tap meaning to switch Korean / English", COLOR_CARD_SOFT, 12, Typeface.NORMAL);
        hint.setPadding(0, dp(8), 0, 0);
        card.addView(hint, matchWrap());
        return card;
    }

    private View buildOverlayActions() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setGravity(Gravity.CENTER_HORIZONTAL);
        shell.setPadding(0, 0, 0, dp(14));

        LinearLayout slideBar = new LinearLayout(this);
        slideBar.setOrientation(LinearLayout.HORIZONTAL);
        slideBar.setGravity(Gravity.CENTER_VERTICAL);
        slideBar.setPadding(dp(18), dp(14), dp(18), dp(14));
        slideBar.setBackground(pill(Color.argb(168, 252, 254, 255), Color.argb(224, 153, 217, 235)));

        overlayUnlockHint = text("< Unlock", COLOR_CARD_TEXT, 15, Typeface.BOLD);
        overlayUnlockHint.setAlpha(0.74f);
        slideBar.addView(overlayUnlockHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView centerIcon = text("|", Color.rgb(96, 126, 145), 13, Typeface.BOLD);
        slideBar.addView(centerIcon, wrapWrap());

        overlayQuizHint = text("Quiz >", COLOR_CARD_TEXT, 15, Typeface.BOLD);
        overlayQuizHint.setAlpha(0.74f);
        overlayQuizHint.setGravity(Gravity.END);
        slideBar.addView(overlayQuizHint, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        shell.addView(slideBar, new LinearLayout.LayoutParams(dp(286), LinearLayout.LayoutParams.WRAP_CONTENT));

        overlayRewardHint = text("", COLOR_CARD_MUTED, 12, Typeface.NORMAL);
        overlayRewardHint.setPadding(0, dp(10), 0, 0);
        shell.addView(overlayRewardHint, matchWrap());

        FrameLayout shortcuts = new FrameLayout(this);
        shortcuts.setPadding(0, dp(22), 0, 0);
        shortcuts.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(78)
        ));

        TextView phone = shortcut("Tel");
        phone.setOnClickListener(v -> {
            scheduleIdleTimeout();
            launchHelperAction(new Intent(Intent.ACTION_DIAL, android.net.Uri.parse("tel:")), false);
        });
        shortcuts.addView(phone, new FrameLayout.LayoutParams(
                dp(56),
                dp(56),
                Gravity.START | Gravity.BOTTOM
        ));

        shortcuts.addView(lockBannerAdSlot(), new FrameLayout.LayoutParams(
                dp(LOCK_BANNER_WIDTH_DP),
                dp(54),
                Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM
        ));

        TextView camera = shortcut("Cam");
        camera.setOnClickListener(v -> {
            scheduleIdleTimeout();
            launchHelperAction(new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA), false);
        });
        shortcuts.addView(camera, new FrameLayout.LayoutParams(
                dp(56),
                dp(56),
                Gravity.END | Gravity.BOTTOM
        ));

        shell.addView(shortcuts, matchWrap());
        return shell;
    }

    private View lockBannerAdSlot() {
        FrameLayout slot = new FrameLayout(this);
        slot.setPadding(0, 0, 0, 0);
        slot.setBackgroundColor(Color.TRANSPARENT);

        TextView label = text("AD", Color.rgb(96, 126, 145), 10, Typeface.BOLD);
        label.setGravity(Gravity.CENTER);
        slot.addView(label, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        overlayBannerAdView = new AdView(this);
        overlayBannerAdView.setAdUnitId(getString(R.string.admob_lock_banner_unit_id));
        overlayBannerAdView.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(this, LOCK_BANNER_WIDTH_DP));
        overlayBannerAdView.setAdListener(new AdListener() {
            @Override
            public void onAdFailedToLoad(LoadAdError loadAdError) {
                Log.w(TAG, "Overlay lock banner failed to load: " + loadAdError.getMessage());
            }
        });
        slot.addView(overlayBannerAdView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
        ));
        overlayBannerAdView.loadAd(new AdRequest.Builder().build());
        return slot;
    }

    private void hideOverlay() {
        cancelPendingLockQuizLaunch();
        hideOverlayForLaunch();
    }

    private void hideOverlayForLaunch() {
        mainHandler.removeCallbacks(clockRefresh);
        mainHandler.removeCallbacks(idleTimeout);
        if (velocityTracker != null) {
            velocityTracker.recycle();
            velocityTracker = null;
        }
        if (overlayBannerAdView != null) {
            overlayBannerAdView.destroy();
            overlayBannerAdView = null;
        }
        if (overlayView == null || windowManager == null) {
            overlayView = null;
            return;
        }
        try {
            windowManager.removeView(overlayView);
            Log.d(TAG, "Overlay lock quiz removed.");
        } catch (RuntimeException ignored) {
        }
        overlayView = null;
    }

    private void showLaunchCover() {
        if (!canShowOverlay() || windowManager == null) {
            return;
        }
        mainHandler.removeCallbacks(coverDismissTimeout);
        if (launchCoverView != null) {
            mainHandler.postDelayed(coverDismissTimeout, COVER_DISMISS_TIMEOUT_MS);
            return;
        }
        try {
            View cover = new View(this);
            cover.setBackgroundColor(Color.rgb(236, 224, 255));
            cover.setAlpha(1f);
            cover.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
            launchCoverView = cover;
            windowManager.addView(cover, buildLaunchCoverLayoutParams());
            Log.d(TAG, "Launch cover attached.");
            mainHandler.postDelayed(coverDismissTimeout, COVER_DISMISS_TIMEOUT_MS);
        } catch (RuntimeException error) {
            launchCoverView = null;
            Log.w(TAG, "Launch cover could not be shown.", error);
        }
    }

    private void hideLaunchCover() {
        mainHandler.removeCallbacks(coverDismissTimeout);
        if (launchCoverView == null || windowManager == null) {
            launchCoverView = null;
            return;
        }
        try {
            windowManager.removeView(launchCoverView);
            Log.d(TAG, "Launch cover removed.");
        } catch (RuntimeException ignored) {
        }
        launchCoverView = null;
    }

    private WindowManager.LayoutParams buildLaunchCoverLayoutParams() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_INSET_DECOR
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                flags,
                android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        return params;
    }

    static void dismissLaunchCoverIfPresent() {
        LockQuizOverlayService instance = activeInstance;
        if (instance == null) {
            return;
        }
        instance.mainHandler.post(instance::hideLaunchCover);
    }

    static void suppressUntilNextScreenOff() {
        LockQuizOverlayService instance = activeInstance;
        if (instance == null) {
            return;
        }
        instance.mainHandler.post(() -> {
            instance.launchSuppressedUntilScreenOff = true;
            instance.cancelPendingLockQuizLaunch();
            instance.hideOverlay();
            instance.hideLaunchCover();
        });
    }

    private void updateOverlayContent() {
        if (currentNotificationWord == null) {
            currentNotificationWord = loadRandomWordForToday();
        }
        if (currentNotificationWord == null) {
            return;
        }
        if (overlayWordView != null) {
            overlayWordView.setText(currentNotificationWord.word);
        }
        if (overlayMetaView != null) {
            overlayMetaView.setText(currentNotificationWord.part + " - Unit " + currentNotificationWord.unit);
        }
        updateOverlayMeaning();
        if (overlayRewardHint != null) {
            overlayRewardHint.setText(shouldShowRewardPrompt()
                    ? "Unlock after one quick word review."
                    : "Word review is active.");
        }
    }

    private void updateOverlayMeaning() {
        if (overlayMeaningView == null || currentNotificationWord == null) {
            return;
        }
        overlayMeaningView.setText(showingEnglishMeaning
                ? currentNotificationWord.english
                : currentNotificationWord.korean);
    }

    private void updateOverlayClock() {
        if (overlayTimeView == null || overlayDateView == null) {
            return;
        }
        Calendar now = Calendar.getInstance();
        java.text.SimpleDateFormat timeFormat = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.KOREAN);
        java.text.SimpleDateFormat dateFormat = new java.text.SimpleDateFormat("EEE, MMM d", java.util.Locale.KOREAN);
        overlayTimeView.setText(timeFormat.format(now.getTime()));
        overlayDateView.setText(dateFormat.format(now.getTime()));
    }

    private void scheduleIdleTimeout() {
        mainHandler.removeCallbacks(idleTimeout);
        mainHandler.postDelayed(idleTimeout, IDLE_TIMEOUT_MS);
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
                if (velocityTracker != null) {
                    velocityTracker.addMovement(event);
                }
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
        if (Math.abs(dx) <= Math.abs(dy) || overlayUnlockHint == null || overlayQuizHint == null) return;

        float ratio = Math.min(1f, Math.abs(dx) / dp(SWIPE_THRESHOLD_DP));
        TextView active = dx < 0 ? overlayUnlockHint : overlayQuizHint;
        TextView inactive = dx < 0 ? overlayQuizHint : overlayUnlockHint;
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
            launchHelperAction(null, true);
        } else if (distanceX > dp(SWIPE_THRESHOLD_DP) || velocityX > dp(SWIPE_VELOCITY_DP)) {
            Intent helper = new Intent(this, LockQuizActivity.class);
            helper.putExtra(LockQuizActivity.EXTRA_ACTION, LockQuizActivity.ACTION_OPEN_QUIZ);
            helper.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            hideOverlay();
            startActivity(helper);
        }
    }

    private void launchHelperAction(Intent shortcutIntent, boolean unlockOnly) {
        launchSuppressedUntilScreenOff = true;
        cancelPendingLockQuizLaunch();
        hideOverlay();
        if (shortcutIntent != null) {
            try {
                shortcutIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(shortcutIntent);
            } catch (RuntimeException error) {
                Log.w(TAG, "Shortcut launch was blocked.", error);
            }
            return;
        }

        Intent helper = new Intent(this, LockQuizActivity.class);
        helper.putExtra(
                LockQuizActivity.EXTRA_ACTION,
                unlockOnly ? LockQuizActivity.ACTION_UNLOCK : LockQuizActivity.ACTION_OPEN_QUIZ
        );
        helper.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            startActivity(helper);
        } catch (RuntimeException error) {
            Log.w(TAG, "Helper activity launch was blocked.", error);
        }
    }

    private void resetSwipeHints() {
        if (overlayUnlockHint != null) {
            overlayUnlockHint.setAlpha(0.74f);
            overlayUnlockHint.setScaleX(1.0f);
            overlayUnlockHint.setScaleY(1.0f);
        }
        if (overlayQuizHint != null) {
            overlayQuizHint.setAlpha(0.74f);
            overlayQuizHint.setScaleX(1.0f);
            overlayQuizHint.setScaleY(1.0f);
        }
    }

    private boolean shouldShowRewardPrompt() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getBoolean(KEY_REWARD_PROMPT, DEFAULT_REWARD_PROMPT);
    }

    private void refreshNotification() {
        startForeground(NOTIFICATION_ID, buildNotification());
        loadNotificationWordAsync();
    }

    private void loadNotificationWordAsync() {
        final int loadToken = ++notificationWordLoadToken;
        new Thread(() -> {
            WordLibrary.WordEntry loadedWord = loadRandomWordForToday();
            mainHandler.post(() -> {
                if (loadToken != notificationWordLoadToken) {
                    return;
                }
                currentNotificationWord = loadedWord;
                startForeground(NOTIFICATION_ID, buildNotification());
                updateOverlayContent();
            });
        }, "lock-word-cache-loader").start();
    }

    private Notification buildNotification() {
        createNotificationChannel();

        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                pendingIntentFlags()
        );

        String title = "Lock quiz is active";
        String content = "Today's words are ready on your lock screen.";
        String bigText = "Wake the phone to review one word before opening EnglishSlide.";

        if (currentNotificationWord != null) {
            title = currentNotificationWord.word + " (" + currentNotificationWord.part + ")";
            content = currentNotificationWord.korean;
            bigText = currentNotificationWord.korean + "\nEnglish: " + currentNotificationWord.english;
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        return builder
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(content)
                .setStyle(new Notification.BigTextStyle().bigText(bigText))
                .setSubText("EnglishSlide")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setColor(0xFF2E7D8A)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_LOW)
                .build();
    }

    private int pendingIntentFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private WordLibrary.WordEntry loadRandomWordForToday() {
        try {
            WordLibrary.WordLoadResult result = WordLibrary.loadTodayWords(this);
            List<WordLibrary.WordEntry> todayWords = result.words;
            if (!todayWords.isEmpty()) {
                return todayWords.get(new Random().nextInt(todayWords.size()));
            }
        } catch (Exception error) {
            Log.w(TAG, "Could not load lock quiz word.", error);
        }
        return WordLibrary.fallbackWord();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Lockscreen quiz",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps EnglishSlide ready for lockscreen word review.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private GradientDrawable rounded(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private GradientDrawable pillish(int color, float radius, int strokeColor) {
        GradientDrawable drawable = rounded(color, radius);
        drawable.setStroke(dp(2), strokeColor);
        return drawable;
    }

    private GradientDrawable pill(int color, int strokeColor) {
        return pillish(color, dp(999), strokeColor);
    }

    private TextView shortcut(String value) {
        TextView view = text(value, Color.rgb(30, 91, 118), 13, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setBackground(pill(Color.argb(168, 252, 254, 255), Color.argb(224, 153, 217, 235)));
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

}
