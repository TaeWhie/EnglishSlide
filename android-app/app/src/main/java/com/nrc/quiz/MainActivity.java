package com.nrc.quiz;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.OnUserEarnedRewardListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    public static final String EXTRA_ROUTE = "com.nrc.quiz.EXTRA_ROUTE";
    public static final String EXTRA_DEBUG_FORCE_REWARD_CLAIMED = "com.nrc.quiz.EXTRA_DEBUG_FORCE_REWARD_CLAIMED";
    private static final String TAG = "MainActivity";
    private static final String TEST_REWARDED_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";
    private static final String TEST_INTERSTITIAL_AD_UNIT_ID = "ca-app-pub-3940256099942544/1033173712";
    private static final String TEST_NATIVE_AD_UNIT_ID = "ca-app-pub-3940256099942544/2247696110";
    private static final String API_BASE = "https://nrc-backend-llgx.onrender.com/v1";
    private static final int RC_GOOGLE_SIGN_IN = 1001;
    private static final int RC_POST_NOTIFICATIONS = 1002;
    private static final String KEY_OVERLAY_PERMISSION_PROMPTED = "overlay_permission_prompted";
    private WebView webView;
    private FrameLayout nativeAdContainer;
    private GoogleSignInClient googleSignInClient;
    private FirebaseAuth firebaseAuth;
    private RewardedAd rewardedAd;
    private InterstitialAd interstitialAd;
    private NativeAd footerNativeAd;
    private boolean rewardedAdLoading;
    private boolean interstitialAdLoading;
    private boolean nativeAdLoading;
    private boolean rewardCallbackPending;
    private boolean rewardEarnedThisSession;
    private boolean interstitialCallbackPending;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        webView = new WebView(this);
        if (isLikelyEmulator()) {
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }
        webView.setFitsSystemWindows(true);
        LinearLayout.LayoutParams webViewParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0
        );
        webViewParams.weight = 1f;
        root.addView(webView, webViewParams);

        nativeAdContainer = new FrameLayout(this);
        nativeAdContainer.setVisibility(View.GONE);
        nativeAdContainer.setBackgroundColor(0xFFFFFFFF);
        nativeAdContainer.setPadding(dp(8), dp(1), dp(8), dp(1));
        nativeAdContainer.setMinimumHeight(dp(36));
        root.addView(nativeAdContainer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        webView.clearCache(true);

        configureGoogleSignIn();
        initializeMobileAds();
        try {
            firebaseAuth = FirebaseAuth.getInstance();
        } catch (IllegalStateException e) {
            firebaseAuth = null;
        }
        webView.addJavascriptInterface(new NativeBridge(), "NRCBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (BuildConfig.DEBUG && getIntent().getBooleanExtra(EXTRA_DEBUG_FORCE_REWARD_CLAIMED, false)) {
                    view.postDelayed(
                            () -> view.evaluateJavascript(
                                    "window.__debugMarkRewardClaimed && window.__debugMarkRewardClaimed();",
                                    null
                            ),
                            1200
                    );
                }
                if (BuildConfig.DEBUG) {
                    logWebViewState("pageFinished");
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(
                        TAG,
                        "WebView console: " + consoleMessage.message()
                                + " @" + consoleMessage.sourceId()
                                + ":" + consoleMessage.lineNumber()
                );
                return super.onConsoleMessage(consoleMessage);
            }
        });
        webView.loadUrl(initialUrl());
        requestStartupPermissions();
        syncLockscreenService();
    }

    private String initialUrl() {
        String route = getIntent().getStringExtra(EXTRA_ROUTE);
        String hash = "quiz".equals(route) ? "#quiz" : "";
        return "file:///android_asset/www/index.html" + hash;
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(0xFFF3F7FB);
        window.setNavigationBarColor(0xFFFFFFFF);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(true);
        }
    }

    private void requestStartupPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, RC_POST_NOTIFICATIONS);
        }

        SharedPreferences prefs = getSharedPreferences(LockQuizOverlayService.PREFS, MODE_PRIVATE);
        boolean lockscreenEnabled = prefs.getBoolean(
                LockQuizOverlayService.KEY_ENABLED,
                LockQuizOverlayService.DEFAULT_ENABLED
        );
        boolean overlayPrompted = prefs.getBoolean(KEY_OVERLAY_PERMISSION_PROMPTED, false);
        if (lockscreenEnabled
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && !Settings.canDrawOverlays(this)
                && !overlayPrompted) {
            prefs.edit().putBoolean(KEY_OVERLAY_PERMISSION_PROMPTED, true).apply();
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName())
            );
            startActivity(intent);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        syncLockscreenService();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null && "quiz".equals(intent.getStringExtra(EXTRA_ROUTE))) {
            webView.loadUrl("file:///android_asset/www/index.html#quiz");
        }
    }

    private void updateNativeLockscreenSettings(boolean enabled, boolean rewardPrompt) {
        SharedPreferences prefs = getSharedPreferences(LockQuizOverlayService.PREFS, MODE_PRIVATE);
        prefs.edit()
                .putBoolean(LockQuizOverlayService.KEY_ENABLED, enabled)
                .putBoolean(LockQuizOverlayService.KEY_REWARD_PROMPT, rewardPrompt)
                .apply();
        syncLockscreenService();
    }

    private void syncLockscreenService() {
        SharedPreferences prefs = getSharedPreferences(LockQuizOverlayService.PREFS, MODE_PRIVATE);
        if (!prefs.contains(LockQuizOverlayService.KEY_ENABLED)) {
            prefs.edit()
                    .putBoolean(LockQuizOverlayService.KEY_ENABLED, LockQuizOverlayService.DEFAULT_ENABLED)
                    .putBoolean(LockQuizOverlayService.KEY_REWARD_PROMPT, LockQuizOverlayService.DEFAULT_REWARD_PROMPT)
                    .apply();
        }
        boolean enabled = prefs.getBoolean(LockQuizOverlayService.KEY_ENABLED, LockQuizOverlayService.DEFAULT_ENABLED);
        Intent service = new Intent(this, LockQuizOverlayService.class);
        if (enabled) {
            service.setAction(LockQuizOverlayService.ACTION_SYNC_SETTINGS);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(service);
            } else {
                startService(service);
            }
        } else {
            stopService(service);
        }
    }

    private void configureGoogleSignIn() {
        String webClientId = getGoogleWebClientId();
        if (webClientId.isEmpty()) {
            googleSignInClient = null;
            return;
        }

        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestIdToken(webClientId)
                .build();
        googleSignInClient = GoogleSignIn.getClient(this, options);
    }

    private void initializeMobileAds() {
        MobileAds.initialize(this, initializationStatus -> {
            loadRewardedAd(false);
            loadInterstitialAd(false);
            loadNativeFooterAd();
        });
    }

    private void loadRewardedAd(boolean showOnLoad) {
        if (rewardedAdLoading) return;
        rewardedAdLoading = true;
        AdRequest request = new AdRequest.Builder().build();
        RewardedAd.load(
                this,
                getRewardedAdUnitId(),
                request,
                new RewardedAdLoadCallback() {
                    @Override
                    public void onAdLoaded(RewardedAd ad) {
                        rewardedAdLoading = false;
                        rewardedAd = ad;
                        Log.d(TAG, "Rewarded ad loaded successfully. unitId=" + getRewardedAdUnitId());
                        if (showOnLoad && rewardCallbackPending) {
                            showRewardedAdInternal();
                        }
                    }

                    @Override
                    public void onAdFailedToLoad(LoadAdError loadAdError) {
                        rewardedAdLoading = false;
                        rewardedAd = null;
                        Log.e(
                                TAG,
                                "Rewarded ad failed to load. code=" + loadAdError.getCode()
                                        + ", domain=" + loadAdError.getDomain()
                                        + ", message=" + loadAdError.getMessage()
                                        + ", unitId=" + getRewardedAdUnitId()
                        );
                        if (showOnLoad && rewardCallbackPending) {
                            rewardCallbackPending = false;
                            dispatchRewardAdResult(false, buildRewardLoadFailMessage(loadAdError), "");
                        }
                    }
                }
        );
    }

    private String getRewardedAdUnitId() {
        if (BuildConfig.DEBUG || isLikelyEmulator()) {
            return TEST_REWARDED_AD_UNIT_ID;
        }
        return getString(R.string.admob_rewarded_quiz_unit_id);
    }

    private String getInterstitialAdUnitId() {
        if (BuildConfig.DEBUG || isLikelyEmulator()) {
            return TEST_INTERSTITIAL_AD_UNIT_ID;
        }
        return getString(R.string.admob_retry_interstitial_unit_id);
    }

    private String getNativeAdUnitId() {
        if (BuildConfig.DEBUG || isLikelyEmulator()) {
            return TEST_NATIVE_AD_UNIT_ID;
        }
        return getString(R.string.admob_native_footer_unit_id);
    }

    private void loadNativeFooterAd() {
        if (nativeAdLoading) return;
        nativeAdLoading = true;

        AdLoader adLoader = new AdLoader.Builder(this, getNativeAdUnitId())
                .forNativeAd(nativeAd -> {
                    nativeAdLoading = false;
                    if (isDestroyed() || isFinishing()) {
                        nativeAd.destroy();
                        return;
                    }
                    if (footerNativeAd != null) {
                        footerNativeAd.destroy();
                    }
                    footerNativeAd = nativeAd;
                    renderNativeFooter(nativeAd);
                })
                .withNativeAdOptions(
                        new NativeAdOptions.Builder()
                                .setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT)
                                .build()
                )
                .withAdListener(new com.google.android.gms.ads.AdListener() {
                    @Override
                    public void onAdFailedToLoad(LoadAdError loadAdError) {
                        nativeAdLoading = false;
                        Log.e(
                                TAG,
                                "Native ad failed to load. code=" + loadAdError.getCode()
                                        + ", domain=" + loadAdError.getDomain()
                                        + ", message=" + loadAdError.getMessage()
                        );
                        if (nativeAdContainer != null) {
                            nativeAdContainer.removeAllViews();
                            nativeAdContainer.setVisibility(View.GONE);
                        }
                    }
                })
                .build();

        adLoader.loadAd(new AdRequest.Builder().build());
    }

    private void renderNativeFooter(NativeAd nativeAd) {
        if (nativeAdContainer == null) return;

        NativeAdView adView = new NativeAdView(this);
        adView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        adView.setBackgroundColor(0xFFFFFFFF);
        adView.setPadding(0, 0, 0, 0);
        adView.setMinimumHeight(dp(36));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(2), 0, dp(2));
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setBaselineAligned(false);
        row.setMinimumHeight(dp(36));

        TextView badge = footerText("광고", 10, 0xFF6B7280, true);
        badge.setMinWidth(dp(32));
        badge.setMinHeight(dp(18));
        badge.setGravity(android.view.Gravity.CENTER);
        badge.setPadding(dp(6), dp(2), dp(6), dp(2));
        badge.setBackgroundColor(0xFFF3F4F6);
        row.addView(badge, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView headline = footerText("", 11, 0xFF111827, true);
        headline.setMaxLines(1);
        headline.setPadding(dp(8), 0, dp(8), 0);
        row.addView(headline, new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f
        ));

        TextView cta = footerText("", 10, 0xFF2563EB, true);
        cta.setMaxLines(1);
        cta.setMinHeight(dp(32));
        cta.setGravity(android.view.Gravity.CENTER);
        cta.setPadding(dp(8), dp(6), dp(8), dp(6));
        row.addView(cta, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        headline.setText(nativeAd.getHeadline());
        cta.setText(nativeAd.getCallToAction());
        cta.setVisibility(nativeAd.getCallToAction() == null || nativeAd.getCallToAction().isEmpty() ? View.GONE : View.VISIBLE);

        adView.setHeadlineView(headline);
        adView.setCallToActionView(cta);
        adView.addView(row);
        adView.setNativeAd(nativeAd);

        nativeAdContainer.removeAllViews();
        nativeAdContainer.addView(adView);
        nativeAdContainer.setVisibility(View.VISIBLE);
    }

    private TextView footerText(String value, int sizeSp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setSingleLine(true);
        view.setLetterSpacing(0f);
        if (bold) {
            view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        }
        return view;
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private String buildRewardLoadFailMessage(LoadAdError loadAdError) {
        if (loadAdError == null) {
            return "광고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
        }
        if (BuildConfig.DEBUG || isLikelyEmulator()) {
            return "광고를 불러오지 못했습니다. code="
                    + loadAdError.getCode()
                    + ", message="
                    + loadAdError.getMessage();
        }
        return "광고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
    }

    private void showRewardedAd() {
        runOnUiThread(() -> {
            rewardCallbackPending = true;
            if (rewardedAd != null) {
                showRewardedAdInternal();
                return;
            }
            loadRewardedAd(true);
        });
    }

    private void loadInterstitialAd(boolean showOnLoad) {
        if (interstitialAdLoading) return;
        interstitialAdLoading = true;
        AdRequest request = new AdRequest.Builder().build();
        InterstitialAd.load(
                this,
                getInterstitialAdUnitId(),
                request,
                new InterstitialAdLoadCallback() {
                    @Override
                    public void onAdLoaded(InterstitialAd ad) {
                        interstitialAdLoading = false;
                        interstitialAd = ad;
                        Log.d(TAG, "Interstitial ad loaded successfully. unitId=" + getInterstitialAdUnitId());
                        if (showOnLoad && interstitialCallbackPending) {
                            showInterstitialAdInternal();
                        }
                    }

                    @Override
                    public void onAdFailedToLoad(LoadAdError loadAdError) {
                        interstitialAdLoading = false;
                        interstitialAd = null;
                        Log.e(
                                TAG,
                                "Interstitial ad failed to load. code=" + loadAdError.getCode()
                                        + ", domain=" + loadAdError.getDomain()
                                        + ", message=" + loadAdError.getMessage()
                                        + ", unitId=" + getInterstitialAdUnitId()
                        );
                        if (showOnLoad && interstitialCallbackPending) {
                            interstitialCallbackPending = false;
                            dispatchInterstitialAdResult(false, buildInterstitialLoadFailMessage(loadAdError), "");
                        }
                    }
                }
        );
    }

    private String buildInterstitialLoadFailMessage(LoadAdError loadAdError) {
        if (loadAdError == null) {
            return "전면광고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
        }
        if (BuildConfig.DEBUG || isLikelyEmulator()) {
            return "전면광고를 불러오지 못했습니다. code="
                    + loadAdError.getCode()
                    + ", message="
                    + loadAdError.getMessage();
        }
        return "전면광고를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
    }

    private void showInterstitialAd() {
        runOnUiThread(() -> {
            interstitialCallbackPending = true;
            if (interstitialAd != null) {
                showInterstitialAdInternal();
                return;
            }
            loadInterstitialAd(true);
        });
    }

    private void showInterstitialAdInternal() {
        InterstitialAd ad = interstitialAd;
        if (ad == null) {
            loadInterstitialAd(true);
            return;
        }

        interstitialAd = null;
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdDismissedFullScreenContent() {
                if (interstitialCallbackPending) {
                    interstitialCallbackPending = false;
                    dispatchInterstitialAdResult(true, "재도전 광고를 완료했습니다.", "");
                }
                loadInterstitialAd(false);
            }

            @Override
            public void onAdFailedToShowFullScreenContent(AdError adError) {
                Log.e(
                        TAG,
                        "Interstitial ad failed to show. code=" + adError.getCode()
                                + ", domain=" + adError.getDomain()
                                + ", message=" + adError.getMessage()
                );
                interstitialCallbackPending = false;
                dispatchInterstitialAdResult(false, "전면광고를 재생하지 못했습니다. 잠시 후 다시 시도해주세요.", "");
                loadInterstitialAd(false);
            }
        });

        ad.show(this);
    }

    private void showRewardedAdInternal() {
        RewardedAd ad = rewardedAd;
        if (ad == null) {
            loadRewardedAd(true);
            return;
        }

        rewardedAd = null;
        rewardEarnedThisSession = false;
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdDismissedFullScreenContent() {
                if (!rewardEarnedThisSession && rewardCallbackPending) {
                    rewardCallbackPending = false;
                    dispatchRewardAdResult(false, "광고를 끝까지 시청해야 포인트를 받을 수 있습니다.", "");
                }
                loadRewardedAd(false);
            }

            @Override
            public void onAdFailedToShowFullScreenContent(AdError adError) {
                Log.e(
                        TAG,
                        "Rewarded ad failed to show. code=" + adError.getCode()
                                + ", domain=" + adError.getDomain()
                                + ", message=" + adError.getMessage()
                );
                rewardCallbackPending = false;
                dispatchRewardAdResult(false, "광고를 재생하지 못했습니다. 잠시 후 다시 시도해주세요.", "");
                loadRewardedAd(false);
            }
        });

        ad.show(this, new OnUserEarnedRewardListener() {
            @Override
            public void onUserEarnedReward(RewardItem rewardItem) {
                rewardEarnedThisSession = true;
                rewardCallbackPending = false;
                String adToken = "admob_rewarded_" + System.currentTimeMillis();
                dispatchRewardAdResult(true, "보상형 광고 시청이 완료되었습니다.", adToken);
            }
        });
    }

    private String getGoogleWebClientId() {
        int generatedId = getResources().getIdentifier("default_web_client_id", "string", getPackageName());
        if (generatedId != 0) {
            return getString(generatedId).trim();
        }
        return getString(R.string.google_web_client_id).trim();
    }

    private boolean isLikelyEmulator() {
        return Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.contains("sdk_gphone")
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("sdk_gphone")
                || Build.MANUFACTURER.contains("Genymotion")
                || "google_sdk".equals(Build.PRODUCT);
    }

    private void logWebViewState(String label) {
        if (webView == null) return;
        webView.evaluateJavascript(
                "(function(){"
                        + "var active=document.querySelector('.view.active');"
                        + "var bodyText=(document.body&&document.body.innerText?document.body.innerText:'').slice(0,400);"
                        + "return JSON.stringify({"
                        + "label:" + JSONObject.quote(label) + ","
                        + "hash:location.hash,"
                        + "appShell:document.querySelector('#appShell')&&document.querySelector('#appShell').className,"
                        + "loginView:document.querySelector('#loginView')&&document.querySelector('#loginView').className,"
                        + "activeView:active&&active.id,"
                        + "modeSelect:document.querySelector('#quizModeSelect')&&document.querySelector('#quizModeSelect').className,"
                        + "quizHead:document.querySelector('#quizHead')&&document.querySelector('#quizHead').className,"
                        + "modeButtons:document.querySelectorAll('.mode-btn').length,"
                        + "bodyText:bodyText"
                        + "});"
                        + "})()",
                value -> Log.d(TAG, "WebView state: " + value)
        );
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != RC_GOOGLE_SIGN_IN) return;

        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            String googleIdToken = account.getIdToken();
            if (googleIdToken == null || googleIdToken.isEmpty()) {
                dispatchGoogleSignInError("Google login token was empty.");
                return;
            }
            signInWithFirebase(account, googleIdToken);
        } catch (ApiException e) {
            dispatchGoogleSignInError("Google login failed. status=" + e.getStatusCode());
        } catch (Exception e) {
            dispatchGoogleSignInError("Google login failed. " + e.getClass().getSimpleName());
        }
    }

    private void signInWithFirebase(GoogleSignInAccount googleAccount, String googleIdToken) {
        if (firebaseAuth == null) {
            dispatchGoogleSignInError("Firebase is not configured. Add google-services.json and rebuild.");
            return;
        }

        AuthCredential credential = GoogleAuthProvider.getCredential(googleIdToken, null);
        firebaseAuth.signInWithCredential(credential).addOnCompleteListener(this, authTask -> {
            if (!authTask.isSuccessful()) {
                Exception error = authTask.getException();
                String detail = error == null ? "" : " " + error.getClass().getSimpleName();
                dispatchGoogleSignInError("Firebase login failed." + detail);
                return;
            }

            FirebaseUser user = firebaseAuth.getCurrentUser();
            if (user == null) {
                dispatchGoogleSignInError("Firebase user was unavailable.");
                return;
            }

            user.getIdToken(true).addOnCompleteListener(tokenTask -> {
                if (!tokenTask.isSuccessful() || tokenTask.getResult() == null) {
                    dispatchGoogleSignInError("Firebase ID token was unavailable.");
                    return;
                }

                String firebaseIdToken = tokenTask.getResult().getToken();
                if (firebaseIdToken == null || firebaseIdToken.isEmpty()) {
                    dispatchGoogleSignInError("Firebase ID token was empty.");
                    return;
                }

                dispatchFirebaseGoogleUser(googleAccount, user, firebaseIdToken);
            });
        });
    }

    private void dispatchFirebaseGoogleUser(GoogleSignInAccount googleAccount, FirebaseUser firebaseUser, String firebaseIdToken) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("provider", "google");
            payload.put("googleSub", firebaseUser.getUid());
            payload.put("firebaseUid", firebaseUser.getUid());
            payload.put("email", firebaseUser.getEmail() == null ? "" : firebaseUser.getEmail());
            payload.put("displayName", googleAccount.getDisplayName() == null ? "Google User" : googleAccount.getDisplayName());
            payload.put("idToken", firebaseIdToken);
            dispatchGoogleSignIn(payload.toString());
        } catch (Exception e) {
            dispatchGoogleSignInError("Firebase login payload failed.");
        }
    }

    private void dispatchGoogleSignIn(String payloadJson) {
        if (webView == null) return;
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onNativeGoogleSignIn && window.onNativeGoogleSignIn(" + JSONObject.quote(payloadJson) + ");",
                null
        ));
    }

    private void dispatchGoogleSignInError(String message) {
        if (webView == null) return;
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onNativeGoogleSignInError && window.onNativeGoogleSignInError(" + JSONObject.quote(message) + ");",
                null
        ));
    }

    private void dispatchRewardAdResult(boolean success, String message, String adToken) {
        if (webView == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("success", success);
            payload.put("message", message == null ? "" : message);
            payload.put("adToken", adToken == null ? "" : adToken);
            runOnUiThread(() -> webView.evaluateJavascript(
                    "window.onNativeRewardAdResult && window.onNativeRewardAdResult(" + JSONObject.quote(payload.toString()) + ");",
                    null
            ));
        } catch (Exception e) {
            Log.e(TAG, "Failed to dispatch reward ad result", e);
        }
    }

    private void dispatchInterstitialAdResult(boolean success, String message, String adToken) {
        if (webView == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("success", success);
            payload.put("message", message == null ? "" : message);
            payload.put("adToken", adToken == null ? "" : adToken);
            runOnUiThread(() -> webView.evaluateJavascript(
                    "window.onNativeInterstitialAdResult && window.onNativeInterstitialAdResult(" + JSONObject.quote(payload.toString()) + ");",
                    null
            ));
        } catch (Exception e) {
            Log.e(TAG, "Failed to dispatch interstitial ad result", e);
        }
    }

    private void dispatchRewardClaimResult(String payloadJson) {
        if (webView == null) return;
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onNativeRewardClaimResult && window.onNativeRewardClaimResult(" + JSONObject.quote(payloadJson) + ");",
                null
        ));
    }

    private void claimQuizRewardNative(String userId, String adToken) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(API_BASE + "/quizzes/reward");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Accept", "application/json");

                JSONObject requestBody = new JSONObject();
                requestBody.put("user_id", userId);
                requestBody.put("ad_token", adToken);

                try (OutputStream os = connection.getOutputStream()) {
                    os.write(requestBody.toString().getBytes(StandardCharsets.UTF_8));
                }

                int statusCode = connection.getResponseCode();
                InputStream stream = statusCode >= 200 && statusCode < 300
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                String responseText = readStream(stream);

                if (statusCode >= 200 && statusCode < 300) {
                    dispatchRewardClaimResult(responseText);
                    return;
                }

                JSONObject errorPayload = new JSONObject();
                errorPayload.put("detail", extractErrorDetail(responseText));
                dispatchRewardClaimResult(errorPayload.toString());
            } catch (Exception e) {
                try {
                    JSONObject errorPayload = new JSONObject();
                    errorPayload.put("detail", "보상 적립 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
                    dispatchRewardClaimResult(errorPayload.toString());
                } catch (Exception ignored) {
                    Log.e(TAG, "Failed to dispatch native reward claim error", ignored);
                }
                Log.e(TAG, "Native reward claim failed", e);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }).start();
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
            return builder.toString();
        }
    }

    private String extractErrorDetail(String responseText) {
        if (responseText == null || responseText.isEmpty()) {
            return "보상 적립 요청에 실패했습니다.";
        }
        try {
            JSONObject json = new JSONObject(responseText);
            return json.optString("detail", responseText);
        } catch (Exception ignored) {
            return responseText;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    public class NativeBridge {
        @JavascriptInterface
        public String runtime() {
            return "Android WebView";
        }

        @JavascriptInterface
        public void openAppSettings() {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }

        @JavascriptInterface
        public void openOverlaySettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())
                );
                startActivity(intent);
            }
        }

        @JavascriptInterface
        public void updateLockscreenSettings(boolean enabled, boolean rewardPrompt) {
            runOnUiThread(() -> updateNativeLockscreenSettings(enabled, rewardPrompt));
        }

        @JavascriptInterface
        public String googleSignIn() {
            if (googleSignInClient == null) {
                return "{\"status\":\"unconfigured\",\"message\":\"Google Client ID is not configured.\"}";
            }
            runOnUiThread(() -> {
                if (firebaseAuth != null) {
                    firebaseAuth.signOut();
                }
                googleSignInClient.signOut().addOnCompleteListener(task ->
                        startActivityForResult(googleSignInClient.getSignInIntent(), RC_GOOGLE_SIGN_IN)
                );
            });
            return "{\"status\":\"pending\"}";
        }

        @JavascriptInterface
        public void signOut() {
            runOnUiThread(() -> {
                if (firebaseAuth != null) {
                    firebaseAuth.signOut();
                }
                if (googleSignInClient != null) {
                    googleSignInClient.signOut();
                }
            });
        }

        @JavascriptInterface
        public String showRewardedAd() {
            MainActivity.this.showRewardedAd();
            return "{\"status\":\"pending\"}";
        }

        @JavascriptInterface
        public String showInterstitialAd() {
            MainActivity.this.showInterstitialAd();
            return "{\"status\":\"pending\"}";
        }

        @JavascriptInterface
        public void claimQuizReward(String userId, String adToken) {
            claimQuizRewardNative(userId, adToken);
        }
    }

    @Override
    protected void onDestroy() {
        if (footerNativeAd != null) {
            footerNativeAd.destroy();
            footerNativeAd = null;
        }
        super.onDestroy();
    }
}
