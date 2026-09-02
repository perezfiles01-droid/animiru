package com.animiru.app;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.Iterator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Performs one request from the device, on behalf of the page.
 *
 * Extensions run on the Animiru server, so their requests come from a
 * hosting provider's address - which sites with bot protection refuse on
 * sight, whatever headers they carry. This phone is on a residential
 * connection and is not refused. When the server is turned away it names the
 * request it could not make, and the page asks for it here instead.
 *
 * A plain fetch() from the page cannot do this: the app is served from a
 * virtual origin inside the WebView, so every request to a site is
 * cross-origin and the browser blocks reading the response. Nothing outside
 * the WebView enforces that, which is the whole reason this class exists.
 *
 * Reachable only from the app's own pages: the WebView loads nothing else,
 * and external links are handed to the real browser rather than opened here.
 */
public final class DeviceFetch {

    /** Matches the server's own cap, so a body cannot be larger here. */
    private static final int MAX_BODY_BYTES = 5 * 1024 * 1024;

    /**
     * How long a browser check may take before the run is told it failed.
     *
     * Generous: a check spins for several seconds by design, and the app's
     * own deadline for a run is 45 seconds.
     */
    private static final int CHALLENGE_TIMEOUT_MS = 25000;

    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 20000;

    private final WebView webView;
    private final ExecutorService pool = Executors.newFixedThreadPool(2);

    DeviceFetch(WebView webView) {
        this.webView = webView;
    }

    /**
     * Asked for by the page, answered later through
     * window.__animiruDeviceFetch.deliver(id, json).
     *
     * Asynchronous because a JavascriptInterface method runs on a WebView
     * thread that must not block, and a scrape can take seconds.
     */
    @JavascriptInterface
    public void request(final String id, final String requestJson) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                deliver(id, perform(requestJson));
            }
        });
    }

    /**
     * Loads one address in a real browser and returns the page it settles on.
     *
     * For a site that answers with a JavaScript check rather than the page.
     * request() above cannot pass one: HttpURLConnection fetches bytes and
     * runs nothing, so it retrieves the check itself and hands that back,
     * and the source parses nothing out of it. The right address was never
     * the problem - this device is not the one being refused - the missing
     * piece is a browser to run what the site sent.
     *
     * The clearance cookie the check leaves behind is kept by the WebView's
     * own CookieManager, and request() sends it from there afterwards, so
     * one solved check serves every later request to that site rather than
     * each one paying for its own.
     */
    @JavascriptInterface
    public void solve(final String id, final String requestJson) {
        try {
            final JSONObject asked = new JSONObject(requestJson);
            final URL url = new URL(asked.getString("url"));

            if (isPrivateAddress(url.getHost())) {
                deliver(id, failure("Refusing to fetch a private address: " + url.getHost()));
                return;
            }

            solveOnMainThread(id, url.toString());
        } catch (Exception error) {
            deliver(id, failure(describe(error)));
        }
    }

    /** True when this build can fetch, which the page checks before asking. */
    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    /**
     * The browser that runs the check.
     *
     * A WebView of its own, never added to a view: the app's own WebView is
     * showing the page that asked for this, and navigating it away would
     * take the user with it. Created and destroyed on the main thread,
     * which is the only thread a WebView may be touched from.
     *
     * Reading the result back is `evaluateJavascript` against the loaded
     * page. The same-origin rule does not apply to the app hosting the
     * WebView, which is precisely why this works where a fetch() from our
     * own page would not.
     */
    private void solveOnMainThread(final String id, final String url) {
        final Handler main = new Handler(Looper.getMainLooper());

        main.post(new Runnable() {
            @Override
            @SuppressLint("SetJavaScriptEnabled")
            public void run() {
                final WebView solver = new WebView(webView.getContext());
                solver.getSettings().setJavaScriptEnabled(true);
                solver.getSettings().setDomStorageEnabled(true);
                solver.getSettings().setUserAgentString(webView.getSettings().getUserAgentString());

                CookieManager.getInstance().setAcceptCookie(true);
                CookieManager.getInstance().setAcceptThirdPartyCookies(solver, true);

                // Answered once, whichever comes first: a page that settles,
                // or the deadline. A check that never clears must not leave
                // the run waiting for ever.
                final AtomicReference<Boolean> answered = new AtomicReference<>(false);

                final Runnable giveUp = new Runnable() {
                    @Override
                    public void run() {
                        if (answered.getAndSet(true)) return;
                        solver.destroy();
                        deliver(id, failure("The browser check did not clear in "
                            + (CHALLENGE_TIMEOUT_MS / 1000) + " seconds"));
                    }
                };

                solver.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, final String loaded) {
                        // A check reloads itself once it passes, so the first
                        // finished page is usually still the check. The page
                        // is read and, if it is still a challenge, left to
                        // load again - the deadline is what ends it.
                        view.evaluateJavascript(
                            "document.documentElement.outerHTML",
                            new ValueCallback<String>() {
                                @Override
                                public void onReceiveValue(String quoted) {
                                    String html = unquote(quoted);
                                    if (html == null || looksLikeChallenge(html)) return;
                                    if (answered.getAndSet(true)) return;

                                    main.removeCallbacks(giveUp);
                                    solver.destroy();
                                    deliver(id, solved(loaded, html));
                                }
                            }
                        );
                    }
                });

                main.postDelayed(giveUp, CHALLENGE_TIMEOUT_MS);
                solver.loadUrl(url);
            }
        });
    }

    /** The page, in the shape every other answer takes. */
    private static JSONObject solved(String url, String html) {
        JSONObject answer = new JSONObject();
        try {
            answer.put("ok", true);
            answer.put("statusCode", 200);
            answer.put("url", url);
            answer.put("body", html);
            answer.put("solved", true);
        } catch (Exception impossible) {
            // JSONObject.put only throws on a NaN value.
        }
        return answer;
    }

    /**
     * Markers of a check still in progress.
     *
     * Deliberately narrow. Reading a real page as a challenge would loop
     * until the deadline and return nothing, so these are phrases the
     * interstitials use and ordinary pages do not.
     */
    private static boolean looksLikeChallenge(String html) {
        String text = html.toLowerCase();
        return text.contains("just a moment")
            || text.contains("cf-browser-verification")
            || text.contains("cf_chl_")
            || text.contains("checking your browser")
            || text.contains("challenge-platform");
    }

    /** evaluateJavascript hands back a JSON string literal, not the string. */
    private static String unquote(String quoted) {
        if (quoted == null || "null".equals(quoted)) return null;

        try {
            return new org.json.JSONTokener(quoted).nextValue().toString();
        } catch (Exception unreadable) {
            return null;
        }
    }

    private static String describe(Exception error) {
        String message = error.getMessage();
        return message == null ? error.getClass().getSimpleName() : message;
    }

    private JSONObject perform(String requestJson) {
        HttpURLConnection connection = null;

        try {
            JSONObject asked = new JSONObject(requestJson);
            URL url = new URL(asked.getString("url"));

            String protocol = url.getProtocol();
            if (!"http".equals(protocol) && !"https".equals(protocol)) {
                return failure("Unsupported protocol: " + protocol);
            }

            // The server refuses to fetch a private address on an
            // extension's behalf, and moving the request to the device must
            // not be a way around that - a source could otherwise reach
            // whatever is on the user's own network.
            if (isPrivateAddress(url.getHost())) {
                return failure("Refusing to fetch a private address: " + url.getHost());
            }

            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(asked.optString("method", "GET").toUpperCase());
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);

            /*
             * The clearance a solved browser check left behind.
             *
             * Set before the source's own headers, so a source that sends
             * its own Cookie wins - it knows something about the site this
             * does not. Without this, every request after a solved check
             * would be challenged again and each would need its own
             * browser, which is the expensive thing this avoids.
             */
            String cookies = CookieManager.getInstance().getCookie(url.toString());
            if (cookies != null && !cookies.isEmpty()) {
                connection.setRequestProperty("Cookie", cookies);
            }

            JSONObject headers = asked.optJSONObject("headers");
            if (headers != null) {
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    connection.setRequestProperty(name, headers.getString(name));
                }
            }

            String body = asked.isNull("body") ? null : asked.optString("body", null);
            if (body != null && !body.isEmpty()) {
                connection.setDoOutput(true);
                connection.getOutputStream().write(body.getBytes("UTF-8"));
                connection.getOutputStream().flush();
            }

            int status = connection.getResponseCode();

            // Anything the site sets goes back to the same jar the WebView
            // reads, so the two halves of this class share one session
            // rather than each keeping its own.
            java.util.List<String> setCookies = connection.getHeaderFields().get("Set-Cookie");
            if (setCookies != null) {
                for (String cookie : setCookies) {
                    CookieManager.getInstance().setCookie(url.toString(), cookie);
                }
            }

            // A refusal still has a body worth returning - it may be the
            // challenge page - and the status is what the caller decides on.
            InputStream stream = status >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();

            JSONObject answer = new JSONObject();
            answer.put("ok", true);
            answer.put("statusCode", status);
            answer.put("url", connection.getURL().toString());
            answer.put("body", stream == null ? "" : readAll(stream));
            return answer;
        } catch (Exception error) {
            String message = error.getMessage();
            return failure(message == null ? error.getClass().getSimpleName() : message);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        ByteArrayOutputStream collected = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;

        while ((read = stream.read(chunk)) != -1) {
            if (collected.size() + read > MAX_BODY_BYTES) {
                throw new Exception("Response larger than " + MAX_BODY_BYTES + " bytes");
            }
            collected.write(chunk, 0, read);
        }

        return collected.toString("UTF-8");
    }

    /**
     * Loopback, the RFC1918 ranges, link-local and CGNAT - the same set the
     * server refuses. Resolving is what makes it meaningful: a public name
     * can point at a private address.
     */
    private static boolean isPrivateAddress(String host) {
        try {
            for (InetAddress address : InetAddress.getAllByName(host)) {
                if (address.isLoopbackAddress() || address.isSiteLocalAddress()
                    || address.isLinkLocalAddress() || address.isAnyLocalAddress()
                    || address.isMulticastAddress()) {
                    return true;
                }

                byte[] octets = address.getAddress();
                if (octets.length == 4) {
                    int first = octets[0] & 0xff;
                    int second = octets[1] & 0xff;
                    // 100.64.0.0/10, which is neither site-local nor public.
                    if (first == 100 && second >= 64 && second <= 127) return true;
                }
            }
        } catch (Exception unresolved) {
            // Left to the request itself to fail on, with a real message.
            return false;
        }
        return false;
    }

    private static JSONObject failure(String message) {
        JSONObject answer = new JSONObject();
        try {
            answer.put("ok", false);
            answer.put("error", message);
        } catch (Exception impossible) {
            // JSONObject.put only throws on a NaN value.
        }
        return answer;
    }

    /** Hands the answer back to the page on the thread the WebView needs. */
    private void deliver(final String id, final JSONObject answer) {
        final String script = "window.__animiruDeviceFetch && "
            + "window.__animiruDeviceFetch.deliver("
            + JSONObject.quote(id) + "," + JSONObject.quote(answer.toString()) + ")";

        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(script, null);
            }
        });
    }
}
