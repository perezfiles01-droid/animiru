package com.animiru.app;

import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Fetches a stream with the headers its host insists on.
 *
 * Sources already know these headers and already send them: a stream option
 * carries a Referer and an Origin because the CDN serving it refuses a
 * request without them. Nothing was using them for the video itself. The
 * player attached them to subtitles, which go through a proxy on the server,
 * and dropped them for the media, which does not - so a hotlink-protected
 * CDN answered the WebView with a refusal and the screen said only that the
 * server could not be played.
 *
 * The page cannot fix that itself. Referer and Origin are forbidden header
 * names in a browser: script is not allowed to set them, precisely so that a
 * page cannot claim to be somewhere it is not. That rule binds JavaScript.
 * It does not bind this class, which is native code making its own request,
 * and that is the whole reason this exists.
 *
 * WHAT THIS COVERS, AND WHAT IT DOES NOT
 *
 * shouldInterceptRequest sees requests the WebView's networking makes -
 * which includes the XHR that hls.js issues for a playlist and for every
 * segment. It does NOT reliably see requests made by the platform's own
 * media stack, which is what a <video> element uses when it plays a URL
 * natively. So HLS played through hls.js is covered here, and progressive
 * MP4 handed straight to a <video> element is not.
 *
 * That is why the player prefers hls.js over native HLS whenever a stream
 * carries headers, even though native playback is otherwise the better
 * choice: it is the difference between a stream that plays and one that
 * does not. A source whose only offering is a header-requiring MP4 remains
 * unfixed by this, and says so rather than being quietly broken.
 */
public final class MediaHeaders {

    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 20000;

    /**
     * How many stream hosts are remembered at once.
     *
     * The page registers a handful per episode and replaces them on the
     * next one. The cap is here so a page that registers without ever
     * clearing cannot grow this without limit.
     */
    private static final int MAX_ENTRIES = 64;

    /**
     * Headers this class will not forward, whatever the page asks.
     *
     * The hop-by-hop ones belong to the connection being made here rather
     * than to the request being described, and letting a page set them
     * means letting it corrupt the transfer.
     */
    private static final String[] BLOCKED = {
        "host", "connection", "content-length", "transfer-encoding", "upgrade"
    };

    /** Registered stream URL (exact) to the headers it needs. */
    private final Map<String, Map<String, String>> byUrl =
        Collections.synchronizedMap(new LinkedHashMap<String, Map<String, String>>());

    /**
     * Told by the page which streams need which headers, before it plays
     * them.
     *
     * Registration is per episode and replaces what came before: the
     * previous episode's hosts are not wanted, and keeping them would mean
     * sending one site's Referer to another.
     */
    @JavascriptInterface
    public void register(String streamsJson) {
        synchronized (byUrl) {
            byUrl.clear();
        }

        if (streamsJson == null || streamsJson.isEmpty()) return;

        try {
            JSONArray streams = new JSONArray(streamsJson);

            for (int i = 0; i < streams.length() && i < MAX_ENTRIES; i++) {
                JSONObject stream = streams.optJSONObject(i);
                if (stream == null) continue;

                String url = stream.optString("url", "");
                JSONObject headers = stream.optJSONObject("headers");
                if (url.isEmpty() || headers == null) continue;

                Map<String, String> clean = new HashMap<String, String>();
                Iterator<String> names = headers.keys();

                while (names.hasNext()) {
                    String name = names.next();
                    if (isBlocked(name)) continue;

                    String value = headers.optString(name, "");
                    if (!value.isEmpty()) clean.put(name, value);
                }

                if (!clean.isEmpty()) byUrl.put(url, clean);
            }
        } catch (Exception e) {
            // A malformed registration means no headers are attached, which
            // is exactly the behaviour before this class existed. It is not
            // worth failing playback over.
        }
    }

    private static boolean isBlocked(String name) {
        String lower = name.toLowerCase(Locale.US);
        for (String blocked : BLOCKED) {
            if (blocked.equals(lower)) return true;
        }
        return false;
    }

    /**
     * The headers registered for a URL, or for the playlist that pulled it.
     *
     * A playlist is registered by name; the segments it then asks for are
     * different URLs beside it that nothing registered. They are matched by
     * their origin and leading path, which is what makes a whole stream
     * work rather than only its first request.
     */
    private Map<String, String> headersFor(String url) {
        Map<String, String> exact = byUrl.get(url);
        if (exact != null) return exact;

        synchronized (byUrl) {
            for (Map.Entry<String, Map<String, String>> entry : byUrl.entrySet()) {
                if (sharesDirectory(entry.getKey(), url)) return entry.getValue();
            }
        }

        return null;
    }

    /** True when two URLs sit in the same directory on the same host. */
    private static boolean sharesDirectory(String registered, String candidate) {
        try {
            URL a = new URL(registered);
            URL b = new URL(candidate);

            if (!a.getHost().equalsIgnoreCase(b.getHost())) return false;

            String directory = a.getPath();
            int slash = directory.lastIndexOf('/');
            if (slash <= 0) return false;

            return b.getPath().startsWith(directory.substring(0, slash + 1));
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Answers one media request, or nothing.
     *
     * Returning null hands the request back to the WebView untouched, which
     * is what must happen for everything this class was not told about.
     */
    WebResourceResponse intercept(WebResourceRequest request) {
        if (request == null) return null;
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;

        String url = request.getUrl() != null ? request.getUrl().toString() : "";
        if (url.isEmpty()) return null;

        Map<String, String> headers = headersFor(url);
        if (headers == null) return null;

        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);

            for (Map.Entry<String, String> header : headers.entrySet()) {
                connection.setRequestProperty(header.getKey(), header.getValue());
            }

            // Range is what makes seeking work, and it belongs to the
            // request the player is actually making rather than to the
            // headers the source described. Dropping it would turn every
            // seek into a fetch of the whole file from the beginning.
            Map<String, String> asked = request.getRequestHeaders();
            if (asked != null) {
                for (Map.Entry<String, String> header : asked.entrySet()) {
                    String name = header.getKey();
                    if (isBlocked(name)) continue;
                    if (headers.containsKey(name)) continue;
                    connection.setRequestProperty(name, header.getValue());
                }
            }

            int status = connection.getResponseCode();
            String type = connection.getContentType();
            String mime = type != null ? type.split(";")[0].trim() : "application/octet-stream";
            String encoding = connection.getContentEncoding();

            // A refusal is returned as itself rather than swallowed: the
            // player reads the status and can say the host refused, which
            // is the whole point of being able to tell these apart.
            InputStream body = status >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();

            Map<String, String> responseHeaders = new HashMap<String, String>();
            // The page and the stream are different origins, and the
            // WebView will not hand the bytes to a media element without
            // being told that is allowed.
            responseHeaders.put("Access-Control-Allow-Origin", "*");

            for (Map.Entry<String, java.util.List<String>> header
                    : connection.getHeaderFields().entrySet()) {
                String name = header.getKey();
                if (name == null || header.getValue().isEmpty()) continue;
                if (isBlocked(name)) continue;

                // Range support: without these the player cannot seek.
                String lower = name.toLowerCase(Locale.US);
                if (lower.equals("content-range") || lower.equals("accept-ranges")
                        || lower.equals("content-type") || lower.equals("content-length")) {
                    responseHeaders.put(name, header.getValue().get(0));
                }
            }

            return new WebResourceResponse(
                mime,
                encoding,
                status,
                reasonFor(status),
                responseHeaders,
                body
            );
        } catch (Exception e) {
            // Handing the request back unfetched is better than answering
            // with an error: the WebView tries it itself, which is exactly
            // what happened before this class existed.
            return null;
        }
    }

    /**
     * A reason phrase for a status.
     *
     * WebResourceResponse rejects an empty one, and the phrase itself is
     * never shown to anyone - only its presence matters.
     */
    private static String reasonFor(int status) {
        if (status == 200) return "OK";
        if (status == 206) return "Partial Content";
        if (status == 403) return "Forbidden";
        if (status == 404) return "Not Found";
        return "Status " + status;
    }
}
