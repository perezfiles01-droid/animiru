package com.animiru.app;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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

    /** True when this build can fetch, which the page checks before asking. */
    @JavascriptInterface
    public boolean isAvailable() {
        return true;
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
