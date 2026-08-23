package com.animiru.app;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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
 */
public class MainActivity extends AppCompatActivity {

    /** Must stay in sync with WebViewAssetLoader's default authority. */
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = APP_ORIGIN + "/index.html";

    private WebView webView;

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
        });

        // Required for the HTML5 video element to enter fullscreen.
        webView.setWebChromeClient(new WebChromeClient());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        // Let the hardware back button walk the SPA's history before leaving.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
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
