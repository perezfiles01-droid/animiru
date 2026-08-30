package com.animiru.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * Hosts the compiled React app, which CI copies into src/main/assets/www.
 *
 * Assets are served through WebViewAssetLoader on an https:// origin rather
 * than loaded over file://. That matters for two reasons:
 *
 *   1. The web app keeps its auth token in localStorage, which file:// origins
 *      restrict on several Android versions.
 *   2. Requests to the API are subject to normal CORS rules instead of the
 *      opaque "null" origin a file:// page would send.
 *
 * A WebView does nothing with a download unless something is listening, so
 * one is attached here - see AppUpdater for why that mattered.
 */
public class MainActivity extends AppCompatActivity {

    /** Must stay in sync with WebViewAssetLoader's default authority. */
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = APP_ORIGIN + "/index.html";

    private WebView webView;

    /** Downloads an update and hands it to the system installer. */
    private AppUpdater updater;

    /** Non-null only while a video is playing fullscreen. */
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private int savedOrientation;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);

        // Handled at "/" rather than "/assets/" so that the absolute asset
        // paths Create React App emits (/static/js/main.*.js) resolve. Mounting
        // deeper would 404 them, and switching CRA to relative paths would
        // instead break on client-side routes like /browse.
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new SpaAssetsHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            /**
             * Keeps the app's own pages in the WebView and sends everything
             * else to the browser.
             *
             * Without this a link to GitHub would load over the app, with no
             * way back but the system gesture, and the user would be left
             * browsing a website inside what looks like Animiru.
             *
             * A download is the exception. This runs before the download
             * listener, so sending an APK to the browser here would hand the
             * update to the browser's downloader and skip the app's own
             * install flow entirely. Those navigations are left alone, and
             * the WebView passes them to the listener instead.
             */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isDownload(request.getUrl())) return false;
                return openExternally(request.getUrl());
            }
        });

        webView.setWebChromeClient(new FullscreenChromeClient());

        // Without this a WebView ignores a download entirely. The Update
        // screen's link to the APK did nothing at all, however many times it
        // was tapped, because nothing was listening for it.
        updater = new AppUpdater(this);
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                updater.download(url, userAgent, contentDisposition);
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // The app is served from an https:// origin (see WebViewAssetLoader
        // above), but a self-hosted media server on the local network is
        // almost always plain http on a private address. The default mixed
        // content policy blocks those requests outright, so a Jellyfin server
        // would silently fail to connect.
        //
        // Trade-off accepted deliberately: this permits http subresources
        // generally, not just for the configured server, because the WebView
        // policy is per-WebView rather than per-origin. Everything else this
        // app talks to (AniList, YouTube) is https and stays https; the
        // relaxation exists so a user can reach a server they run themselves.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // A WebView drops window.open and target="_blank" unless it is told
        // to support multiple windows - silently, with no error anywhere. The
        // download link used one, so tapping it did nothing at all. Rather
        // than opening a second WebView, FullscreenChromeClient hands the
        // request to the browser, which is what such a link means in an app.
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        // Back leaves fullscreen first, then walks the SPA's history.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customView != null) {
                    exitFullscreen();
                } else if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /**
     * Whether a URL is something to download rather than to open.
     *
     * Only the extension is available at this point - no response, so no
     * Content-Type - which is enough for the one case that matters.
     */
    private static boolean isDownload(Uri url) {
        if (url == null) return false;
        String path = url.getPath();
        return path != null && path.toLowerCase().endsWith(".apk");
    }

    /**
     * Opens a URL outside the app.
     *
     * @return true when the WebView should not load it itself
     */
    private boolean openExternally(Uri url) {
        if (url == null) return false;

        // The app's own pages stay in the WebView; everything else leaves.
        if (APP_ORIGIN.equals(url.getScheme() + "://" + url.getAuthority())) {
            return false;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nothing on this device can open that link",
                    Toast.LENGTH_LONG).show();
        }
        return true;
    }

    @Override
    protected void onDestroy() {
        if (updater != null) updater.release();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    /**
     * Gives the WebView somewhere to put a fullscreen video.
     *
     * A bare WebChromeClient is not enough: without onShowCustomView the
     * fullscreen button in an embedded player is inert, because the WebView has
     * nowhere to hand the video surface. That matters here specifically because
     * fullscreen is where a 1080p stream is actually worth watching.
     */
    private final class FullscreenChromeClient extends WebChromeClient {

        /**
         * Handles a link that asks for a new window.
         *
         * Enabling multiple windows is not enough on its own: without this,
         * the request is still dropped and target="_blank" still does
         * nothing. There is no second WebView to open into, so the URL is
         * handed to the browser instead - which is what such a link means
         * inside an app.
         *
         * The target URL is not passed to this callback, so the usual trick
         * applies: give the platform a throwaway WebView, read the URL from
         * the navigation it immediately attempts, and discard it.
         */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog,
                                      boolean isUserGesture, Message resultMsg) {
            final WebView probe = new WebView(view.getContext());
            probe.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    openExternally(request.getUrl());
                    v.destroy();
                    return true;
                }
            });

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(probe);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                // Already fullscreen; the platform contract is to reject the
                // second request rather than leak the first view.
                callback.onCustomViewHidden();
                return;
            }

            customView = view;
            customViewCallback = callback;
            savedOrientation = getRequestedOrientation();

            FrameLayout decor = (FrameLayout) getWindow().getDecorView();
            decor.addView(customView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));

            webView.setVisibility(View.GONE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }
    }

    private void exitFullscreen() {
        if (customView == null) {
            return;
        }

        ((FrameLayout) getWindow().getDecorView()).removeView(customView);
        customView = null;

        webView.setVisibility(View.VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(savedOrientation);

        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    /**
     * Serves files from src/main/assets, falling back to the SPA's index.html
     * for paths that don't exist on disk.
     *
     * React Router uses the history API, so a client-side route such as
     * /browse has no matching asset. Without this fallback the loader returns
     * a 404 and the app renders a blank page after any reload on a non-root
     * route.
     */
    private static final class SpaAssetsHandler implements WebViewAssetLoader.PathHandler {

        private static final String INDEX_PATH = "index.html";

        private final WebViewAssetLoader.AssetsPathHandler delegate;

        SpaAssetsHandler(MainActivity activity) {
            this.delegate = new WebViewAssetLoader.AssetsPathHandler(activity);
        }

        @Override
        public WebResourceResponse handle(String path) {
            WebResourceResponse response = delegate.handle(path);
            if (response != null) {
                return response;
            }
            // Only fall back for navigations, not for missing images or scripts:
            // a missing .js should stay a 404 so the failure is visible.
            if (hasFileExtension(path)) {
                return null;
            }
            return delegate.handle(INDEX_PATH);
        }

        private static boolean hasFileExtension(String path) {
            int lastSlash = path.lastIndexOf('/');
            int lastDot = path.lastIndexOf('.');
            return lastDot > lastSlash;
        }
    }
}
