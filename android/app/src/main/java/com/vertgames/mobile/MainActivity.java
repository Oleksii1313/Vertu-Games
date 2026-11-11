package com.vertgames.mobile;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Native Android host for the bundled, offline-first VertGames web project. */
public final class MainActivity extends android.app.Activity {
    private static final String TAG = "VertGames";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_ASSETS_PREFIX = "/assets/www/";
    private static final String HOME_URL = "https://" + APP_HOST + APP_ASSETS_PREFIX + "index.html";
    private static final int INK = Color.rgb(26, 34, 48);
    private static final int TEAL = Color.rgb(43, 153, 160);

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private boolean isFinishingForExit;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        createContent();
        createWebView();

        if (savedInstanceState != null) {
            if (webView.restoreState(savedInstanceState) == null) {
                webView.loadUrl(HOME_URL);
            }
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(INK);
        window.setNavigationBarColor(INK);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        // Android 15 enforces edge-to-edge for target 35; the root view below applies
        // the system-bar/cutout insets so touch controls remain clear of gesture areas.
        if (Build.VERSION.SDK_INT >= 30 && Build.VERSION.SDK_INT < 35) {
            window.setDecorFitsSystemWindows(true);
        }
    }

    private void createContent() {
        root = new FrameLayout(this);
        root.setBackgroundColor(INK);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        }

        progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        if (Build.VERSION.SDK_INT >= 21) {
            progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(TEAL));
        }
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER);
        root.addView(progress, progressParams);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(24), dp(28), dp(24));
        errorPanel.setVisibility(View.GONE);
        TextView title = new TextView(this);
        title.setText(R.string.load_error_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        TextView detail = new TextView(this);
        detail.setText(R.string.load_error_message);
        detail.setTextColor(Color.rgb(167, 183, 202));
        detail.setTextSize(14);
        detail.setGravity(Gravity.CENTER);
        detail.setPadding(0, dp(10), 0, dp(16));
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> {
            errorPanel.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
            webView.loadUrl(HOME_URL);
        });
        errorPanel.addView(title);
        errorPanel.addView(detail);
        errorPanel.addView(retry);
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(errorPanel, errorParams);
        setContentView(root);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(INK);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setHapticFeedbackEnabled(true);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setWebViewClient(new LocalAppWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setVisibility(value >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                }
                return true;
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) {
            settings.setSafeBrowsingEnabled(true);
        }
        webView.addJavascriptInterface(new AndroidBridge(this), "VertGamesAndroid");

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(webView, 0, params);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean isAppAssets(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && APP_HOST.equalsIgnoreCase(uri.getHost());
    }

    private WebResourceResponse response(int status, String reason, String mime, String body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse(mime, "UTF-8", status, reason, headers,
                new ByteArrayInputStream(bytes));
    }

    private WebResourceResponse notFound() {
        return response(404, "Not Found", "text/plain", "VertGames asset not found");
    }

    private WebResourceResponse offlineApiResponse() {
        String json = "{\"ok\":false,\"code\":\"BACKEND_UNAVAILABLE\",\"msg\":"
                + "\"Сервер аккаунтов не включён в автономное приложение. Играть можно без входа. / "
                + "The account server is not bundled with this offline app; guest play is available.\"}";
        return response(503, "Service Unavailable", "application/json", json);
    }

    private WebResourceResponse assetResponse(String urlPath) {
        if (urlPath.equals("/")) {
            urlPath = APP_ASSETS_PREFIX + "index.html";
        }
        if (urlPath.equals("/assets/www")) {
            urlPath = APP_ASSETS_PREFIX + "index.html";
        }
        if (!urlPath.startsWith(APP_ASSETS_PREFIX)) {
            return notFound();
        }

        String assetPath = "www/" + urlPath.substring(APP_ASSETS_PREFIX.length());
        for (String segment : assetPath.split("/")) {
            if (segment.equals(".") || segment.equals("..") || segment.indexOf('\\') >= 0) {
                return notFound();
            }
        }

        try {
            InputStream input = getAssets().open(assetPath, android.content.res.AssetManager.ACCESS_STREAMING);
            String extension = extension(assetPath);
            String mime = mimeType(extension);
            String encoding = isText(extension) ? "UTF-8" : null;
            Map<String, String> headers = new HashMap<>();
            // The bundle can change between APK versions at the same app-assets URL.
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            if ("gz".equals(extension)) {
                // These project data files are pre-compressed JSON. Preserve their bytes
                // in the APK and let Chromium transparently decode the gzip response.
                mime = "application/json";
                headers.put("Content-Encoding", "gzip");
            }
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, input);
        } catch (IOException | RuntimeException error) {
            Log.w(TAG, "Missing bundled asset: " + assetPath, error);
            return notFound();
        }
    }

    private static String extension(String path) {
        int dot = path.lastIndexOf('.');
        return dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static boolean isText(String extension) {
        return extension.equals("html") || extension.equals("htm") || extension.equals("js")
                || extension.equals("css") || extension.equals("json") || extension.equals("svg")
                || extension.equals("txt") || extension.equals("xml");
    }

    private static String mimeType(String extension) {
        switch (extension) {
            case "html":
            case "htm": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "glb": return "model/gltf-binary";
            case "gz": return "application/json";
            case "txt": return "text/plain";
            case "xml": return "application/xml";
            default:
                String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                return guessed != null ? guessed : "application/octet-stream";
        }
    }

    private boolean launchExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            Log.i(TAG, "No external activity for " + uri.getScheme());
            return false;
        }
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ("about".equals(scheme) && "blank".equals(uri.getSchemeSpecificPart())) {
            return false;
        }
        if (isAppAssets(uri)) {
            return false;
        }
        if ("https".equals(scheme) || "http".equals(scheme)
                || "mailto".equals(scheme) || "tel".equals(scheme)) {
            launchExternal(uri);
            return true;
        }
        if ("intent".equals(scheme)) {
            try {
                Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                if (intent.resolveActivity(getPackageManager()) != null) {
                    startActivity(intent);
                    return true;
                }
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null) launchExternal(Uri.parse(fallback));
            } catch (Exception error) {
                Log.w(TAG, "Could not open external intent", error);
            }
            return true;
        }
        return true;
    }

    private void showLoadError() {
        progress.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private final class LocalAppWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isAppAssets(uri)) return null;
            String path = uri.getPath() == null ? "/" : uri.getPath();
            if (path.equals("/api") || path.startsWith("/api/")
                    || path.equals(APP_ASSETS_PREFIX + "api")
                    || path.startsWith(APP_ASSETS_PREFIX + "api/")) {
                return offlineApiResponse();
            }
            return assetResponse(path);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(Uri.parse(url));
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            progress.setVisibility(View.GONE);
            errorPanel.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isAppAssets(request.getUrl())) {
                Log.e(TAG, "Local app load failed: " + error.getDescription());
                showLoadError();
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request.isForMainFrame() && isAppAssets(request.getUrl())
                    && errorResponse.getStatusCode() >= 400) {
                Log.e(TAG, "Local app returned HTTP " + errorResponse.getStatusCode());
                showLoadError();
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            Log.e(TAG, "WebView renderer exited (crashed=" + detail.didCrash() + ")");
            if (view == webView) {
                String restoreUrl = view.getUrl();
                root.removeView(view);
                view.removeJavascriptInterface("VertGamesAndroid");
                view.destroy();
                createWebView();
                webView.loadUrl(isAppAssets(Uri.parse(restoreUrl == null ? HOME_URL : restoreUrl))
                        ? restoreUrl : HOME_URL);
            }
            return true;
        }
    }

    /** Small, app-origin-only interface used by the portal for guest play and screen wake lock. */
    public static final class AndroidBridge {
        private final WeakReference<MainActivity> activity;

        AndroidBridge(MainActivity activity) {
            this.activity = new WeakReference<>(activity);
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public void keepScreenOn(boolean keepOn) {
            MainActivity owner = activity.get();
            if (owner == null) return;
            owner.runOnUiThread(() -> {
                if (owner.webView != null && !owner.isFinishing()) {
                    owner.webView.setKeepScreenOn(keepOn);
                }
            });
        }
    }

    private static final String BACK_HANDLER = "(function(){"
            + "var game=document.getElementById('playFrame');"
            + "if(game&&game.classList.contains('open')&&typeof closeGame==='function'){closeGame();return true;}"
            + "var actions={authModal:'toggleAuth',profileModal:'toggleProfile',shopModal:'toggleShop',aboutModal:'toggleAbout',gameModal:'closeGameInfo'};"
            + "for(var id in actions){var el=document.getElementById(id);if(el&&el.classList.contains('open')){"
            + "var fn=window[actions[id]];if(typeof fn==='function')fn(false);else el.classList.remove('open');return true;}}"
            + "var header=document.querySelector('.header.open');if(header){header.classList.remove('open');return true;}"
            + "return false;})()";

    private static final String BLUR_IFRAMES = "(function(){"
            + "function emit(w,n){try{w.dispatchEvent(new Event(n));}catch(e){}}"
            + "emit(window,'blur');try{var f=document.getElementById('gameFrame');if(f&&f.contentWindow)emit(f.contentWindow,'blur');}catch(e){}"
            + "})()";

    private static final String FOCUS_IFRAMES = "(function(){"
            + "function emit(w,n){try{w.dispatchEvent(new Event(n));}catch(e){}}"
            + "emit(window,'focus');try{var f=document.getElementById('gameFrame');if(f&&f.contentWindow)emit(f.contentWindow,'focus');}catch(e){}"
            + "try{var p=document.getElementById('playFrame');if(p&&p.classList.contains('open'))VertGamesAndroid.keepScreenOn(true);}catch(e){}"
            + "})()";

    @Override
    public void onBackPressed() {
        if (webView == null || isFinishingForExit) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(BACK_HANDLER, value -> {
            if (isFinishingForExit || isFinishing()) return;
            if ("true".equals(value)) return;
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                showExitConfirmation();
            }
        });
    }

    private void showExitConfirmation() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.exit_title)
                .setMessage(R.string.exit_message)
                .setNegativeButton(R.string.stay, (dialog, which) -> dialog.dismiss())
                .setPositiveButton(R.string.exit, (dialog, which) -> {
                    isFinishingForExit = true;
                    finish();
                })
                .show();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript(BLUR_IFRAMES, null);
            webView.setKeepScreenOn(false);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
            webView.evaluateJavascript(FOCUS_IFRAMES, null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("VertGamesAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
