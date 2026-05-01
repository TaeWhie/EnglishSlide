package com.nrc.quiz;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int RC_GOOGLE_SIGN_IN = 1001;
    private WebView webView;
    private GoogleSignInClient googleSignInClient;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        configureGoogleSignIn();
        webView.addJavascriptInterface(new NativeBridge(), "NRCBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void configureGoogleSignIn() {
        String webClientId = getString(R.string.google_web_client_id).trim();
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != RC_GOOGLE_SIGN_IN) return;

        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            JSONObject payload = new JSONObject();
            payload.put("provider", "google");
            payload.put("googleSub", account.getId());
            payload.put("email", account.getEmail() == null ? "" : account.getEmail());
            payload.put("displayName", account.getDisplayName() == null ? "Google User" : account.getDisplayName());
            payload.put("idToken", account.getIdToken());
            dispatchGoogleSignIn(payload.toString());
        } catch (Exception e) {
            dispatchGoogleSignInError("Google 로그인에 실패했습니다.");
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
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }

        @JavascriptInterface
        public String googleSignIn() {
            if (googleSignInClient == null) {
                return "{\"status\":\"unconfigured\",\"message\":\"Google Client ID가 설정되지 않았습니다.\"}";
            }
            runOnUiThread(() -> startActivityForResult(googleSignInClient.getSignInIntent(), RC_GOOGLE_SIGN_IN));
            return "{\"status\":\"pending\"}";
        }
    }
}
