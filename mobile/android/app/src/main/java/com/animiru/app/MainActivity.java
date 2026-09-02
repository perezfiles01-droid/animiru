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
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.io.OutputStream;
import java.net.URLDecoder;
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
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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
    /**
     * The app is opened at index.html, the file.
     *
     * This was changed to "/" to put React Router on a path it declares a
     * route for, and that shipped an app which would not open at all:
     * WebViewAssetLoader strips the leading slash, so "/" reaches the handler
     * below as an empty string, and AssetsPathHandler does not return null
     * for it - it returns a response the WebView cannot read, which is the
     * ERR_INVALID_RESPONSE users saw instead of the app.
     *
     * Loading the file is what worked for months, and the blank first screen
     * it used to cause is now handled where it belongs: App.js declares a
     * catch-all route, so /index.html renders the front page instead of
     * matching nothing. The handler below also answers the root properly
     * now, but this does not rely on that.
     */
    private static final String START_URL = APP_ORIGIN + "/index.html";

    private WebView webView;

    /** Downloads an update and hands it to the system installer. */
    private AppUpdater updater;

    /** Non-null only while a video is playing fullscreen. */
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private int savedOrientation;

    /**
     * The pending <input type="file"> callback.
     *
     * A WebView will not open a file picker on its own: without
     * onShowFileChooser the input is inert and tapping it does nothing at
     * all, which is what "Import settings" did.
     */
    private ValueCallback<Uri[]> pendingFileCallback;

    private final ActivityResultLauncher<String[]> filePicker =
            registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
                if (pendingFileCallback == null) return;
                // A cancelled picker must still answer, or the input stays
                // wedged and never opens again.
                pendingFileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
                pendingFileCallback = null;
            });

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

        // Streams whose CDN refuses a request without the Referer the source
        // used. The page registers them before it plays; every other request
        // passes through untouched.
        final MediaHeaders mediaHeaders = new MediaHeaders();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // The app's own files first: they are the common case, and a
                // stream is never served from the asset loader.
                WebResourceResponse asset = assetLoader.shouldInterceptRequest(request.getUrl());
                if (asset != null) return asset;

                // Then a registered stream, fetched with the headers a
                // browser will not let the page set for itself. Null when
                // this is not one, which leaves the request exactly as it
                // was.
                return mediaHeaders.intercept(request);
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
                // Not everything downloaded is an update. Handing a settings
                // backup to the updater was one of two reasons Export did
                // nothing: the data: URL never reached here, and would have
                // been treated as an APK if it had.
                if (url != null && url.startsWith("data:")) {
                    saveDataUrl(url, contentDisposition);
                    return;
                }
                updater.download(url, userAgent, contentDisposition);
            }
        });

        // Lets the page make one request from this device when the server
        // is refused by a site. See DeviceFetch for why a plain fetch()
        // cannot do it.
        webView.addJavascriptInterface(new DeviceFetch(webView), "AnimiruDeviceFetch");
        webView.addJavascriptInterface(mediaHeaders, "AnimiruMediaHeaders");

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
    /**
     * Navigations the download listener should see rather than the browser.
     *
     * A data: URL is here because that is how the app saves a settings
     * backup. Sending it to the browser - which is what happened before -
     * cannot work: no external app will open a data: URL, so the Export
     * button did nothing at all.
     */
    private static boolean isDownload(Uri url) {
        if (url == null) return false;
        if ("data".equalsIgnoreCase(url.getScheme())) return true;
        String path = url.getPath();
        return path != null && path.toLowerCase().endsWith(".apk");
    }

    /** Filename from a Content-Disposition, or a dated default. */
    private static String backupFileName(String contentDisposition) {
        if (contentDisposition != null) {
            int at = contentDisposition.indexOf("filename=");
            if (at >= 0) {
                String name = contentDisposition.substring(at + 9).replace("\"", "").trim();
                if (!name.isEmpty()) return name;
            }
        }
        return "animiru-backup.json";
    }

    /**
     * Writes a data: URL into the public Downloads folder.
     *
     * MediaStore rather than a file path: from Android 10 an app cannot
     * write to shared storage directly, and a backup the user cannot find
     * afterwards is no better than one that was never saved.
     */
    private void saveDataUrl(String url, String contentDisposition) {
        try {
            int comma = url.indexOf(',');
            if (comma < 0) throw new IllegalArgumentException("malformed data URL");

            String meta = url.substring(0, comma);
            String payload = url.substring(comma + 1);

            byte[] bytes = meta.contains(";base64")
                    ? Base64.decode(payload, Base64.DEFAULT)
                    : URLDecoder.decode(payload, "UTF-8").getBytes("UTF-8");

            String name = backupFileName(contentDisposition);

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

            Uri target = getContentResolver()
                    .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) throw new IllegalStateException("no download entry");

            try (OutputStream out = getContentResolver().openOutputStream(target)) {
                if (out == null) throw new IllegalStateException("no stream");
                out.write(bytes);
            }

            Toast.makeText(this, "Saved " + name + " to Downloads", Toast.LENGTH_LONG).show();
        } catch (Exception err) {
            // Said out loud rather than swallowed: a save that fails in
            // silence is indistinguishable from a button that does nothing,
            // which is the bug this replaces. The Copy button is the way
            // through when this cannot work.
            Toast.makeText(this, "Could not save the backup - use Copy backup instead",
                    Toast.LENGTH_LONG).show();
        }
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
         * Opens the system file picker for <input type="file">.
         *
         * Without this the input is inert - the WebView drops the request
         * and nothing happens, which is exactly what "Import settings" did.
         */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            // An earlier request that never resolved would leave the input
            // permanently wedged, so it is answered before being replaced.
            if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = callback;

            String[] types = params != null ? params.getAcceptTypes() : null;
            if (types == null || types.length == 0 || types[0].isEmpty()) {
                types = new String[]{"*/*"};
            }

            try {
                filePicker.launch(types);
                return true;
            } catch (Exception err) {
                pendingFileCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
        }

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
            setSystemBarsHidden(true);
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
        setSystemBarsHidden(false);

        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    /**
     * Takes the clock, battery and navigation buttons off the screen while a
     * video is fullscreen, and puts them back afterwards.
     *
     * Entering fullscreen used to lock the orientation and keep the screen
     * awake but leave the system bars exactly where they were, so a 19:52
     * and a battery percentage sat on top of the video for its whole
     * runtime.
     *
     * The bars are hidden rather than removed: a swipe from the edge brings
     * them back for a few seconds, so Back and Home are still reachable. An
     * app that took them away outright would be a worse problem than the one
     * being fixed.
     *
     * Restoring is not optional. A shell that hides the bars and forgets to
     * show them again leaves the app unusable everywhere else, which is why
     * this is one method with a flag rather than two that can drift apart.
     */
    private void setSystemBarsHidden(boolean hidden) {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());

        // The video fills the window rather than being laid out inside the
        // space the bars used to occupy - otherwise hiding them leaves the
        // gap behind.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !hidden);

        if (hidden) {
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }

        // On a phone with a cutout the window stops short of it by default,
        // which letterboxes a landscape video against a black band. Only
        // while fullscreen: elsewhere the app wants the safe area.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = hidden
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(attributes);
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
            // The root is the app, and it has to be answered before the
            // delegate is asked.
            //
            // WebViewAssetLoader strips the leading slash, so a request for
            // "/" arrives here as an empty string. AssetsPathHandler does not
            // return null for that - it answers with a response the WebView
            // cannot read - so the fallback at the end of this method never
            // ran, and pointing the shell at "/" produced ERR_INVALID_RESPONSE
            // and an app that would not open. Checking after the delegate is
            // too late; the order here is the whole fix.
            if (path == null || path.isEmpty() || "/".equals(path)) {
                return delegate.handle(INDEX_PATH);
            }

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
