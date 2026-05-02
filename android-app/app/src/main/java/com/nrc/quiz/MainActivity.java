package com.nrc.quiz;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.AlertDialog;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
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
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int RC_GOOGLE_SIGN_IN = 1001;
    private static final int RC_POST_NOTIFICATIONS = 1002;
    private WebView webView;
    private GoogleSignInClient googleSignInClient;
    private FirebaseAuth firebaseAuth;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();

        webView = new WebView(this);
        webView.setFitsSystemWindows(true);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        configureGoogleSignIn();
        try {
            firebaseAuth = FirebaseAuth.getInstance();
        } catch (IllegalStateException e) {
            firebaseAuth = null;
        }
        webView.addJavascriptInterface(new NativeBridge(), "NRCBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/www/index.html");
        requestStartupPermissions();
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

        if (!Settings.canDrawOverlays(this)) {
            new AlertDialog.Builder(this)
                    .setTitle("잠금화면 퀴즈 권한")
                    .setMessage("잠금화면 위에 퀴즈와 보상 안내를 보여주려면 '다른 앱 위에 표시' 권한이 필요합니다.")
                    .setPositiveButton("권한 설정", (dialog, which) -> openOverlayPermissionSettings())
                    .setNegativeButton("나중에", null)
                    .show();
        }
    }

    private void openOverlayPermissionSettings() {
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
        intent.setData(Uri.parse("package:" + getPackageName()));
        startActivity(intent);
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

    private String getGoogleWebClientId() {
        int generatedId = getResources().getIdentifier("default_web_client_id", "string", getPackageName());
        if (generatedId != 0) {
            return getString(generatedId).trim();
        }
        return getString(R.string.google_web_client_id).trim();
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
            openOverlayPermissionSettings();
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
    }
}
