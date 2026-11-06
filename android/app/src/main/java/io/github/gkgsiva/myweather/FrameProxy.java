package io.github.gkgsiva.myweather;

import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Fetches a few requests itself so the MyWeather page can use them:
 *
 * - Wunderground and Kea blog pages shown in a frame under the app's menu.
 *   Wunderground forbids framing (X-Frame-Options / CSP frame-ancestors), so
 *   those headers are dropped. The page also gets the ad-slot style and
 *   links set to open in the same frame.
 * - Data the page reads with fetch() from sites that send no CORS header
 *   (IMD's warning feed, radar images kept for offline use, the cyclone page,
 *   Chennai Metro Water's lake levels) gets Access-Control-Allow-Origin.
 * - OpenStreetMap tiles for the station map are fetched with a User-Agent
 *   naming the app, as OpenStreetMap's tile usage policy asks; it blocks the
 *   WebView's generic browser one.
 *
 * Runs on the WebView's background thread (shouldInterceptRequest).
 */
final class FrameProxy {
    private static final int TIMEOUT_MS = 30000;

    private FrameProxy() {}

    /** A frame document from an in-app site, with framing allowed and ads hidden. */
    static WebResourceResponse frameDocument(WebResourceRequest request, String hideAdsCss) {
        try {
            Fetched f = fetch(request);
            if (f.mime.equals("text/html")) {
                String html = new String(f.body, f.charset);
                String inject = "<base target=\"_self\"><style id=\"myweather-noads\">" + hideAdsCss + "</style>";
                int head = indexOfIgnoreCase(html, "<head");
                int at = head < 0 ? -1 : html.indexOf('>', head);
                html = at < 0 ? inject + html : html.substring(0, at + 1) + inject + html.substring(at + 1);
                f.body = html.getBytes(f.charset);
            }
            f.headers.remove("x-frame-options");
            f.headers.remove("content-security-policy");
            return f.toResponse();
        } catch (IOException e) {
            return null; // let the WebView load it normally
        }
    }

    /** A cross-site data request, answered with a CORS header. */
    static WebResourceResponse withCors(WebResourceRequest request) {
        try {
            Fetched f = fetch(request);
            f.headers.put("access-control-allow-origin", "*");
            f.headers.put("access-control-expose-headers", "last-modified, date");
            return f.toResponse();
        } catch (IOException e) {
            return null;
        }
    }

    /** A map tile, fetched with the given User-Agent and no Referer. */
    static WebResourceResponse withUserAgent(WebResourceRequest request, String userAgent) {
        try {
            Fetched f = fetch(request, userAgent);
            return f.toResponse();
        } catch (IOException e) {
            return null;
        }
    }

    private static int indexOfIgnoreCase(String s, String needle) {
        return s.toLowerCase(Locale.ROOT).indexOf(needle);
    }

    private static final class Fetched {
        int status;
        String reason;
        String mime;
        Charset charset;
        byte[] body;
        final Map<String, String> headers = new HashMap<>();

        WebResourceResponse toResponse() {
            // WebResourceResponse rejects 3xx and empty reasons; redirects are
            // already followed by HttpURLConnection.
            int code = (status < 100 || (status >= 300 && status < 400)) ? 200 : status;
            String why = (reason == null || reason.trim().isEmpty()) ? "OK" : reason;
            return new WebResourceResponse(mime, charset.name(), code, why, headers,
                    new ByteArrayInputStream(body));
        }
    }

    private static Fetched fetch(WebResourceRequest request) throws IOException {
        return fetch(request, null);
    }

    private static Fetched fetch(WebResourceRequest request, String userAgent) throws IOException {
        String url = request.getUrl().toString();
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        conn.setInstanceFollowRedirects(true);
        for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
            if (userAgent != null && (h.getKey().equalsIgnoreCase("user-agent")
                    || h.getKey().equalsIgnoreCase("referer"))) {
                continue;
            }
            conn.setRequestProperty(h.getKey(), h.getValue());
        }
        if (userAgent != null) conn.setRequestProperty("User-Agent", userAgent);
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(url);
        if (cookie != null) conn.setRequestProperty("Cookie", cookie);
        // Plain bytes, so the body can be edited.
        conn.setRequestProperty("Accept-Encoding", "identity");

        Fetched f = new Fetched();
        f.status = conn.getResponseCode();
        f.reason = conn.getResponseMessage();
        InputStream in = f.status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        f.body = in == null ? new byte[0] : readAll(in);

        for (Map.Entry<String, List<String>> h : conn.getHeaderFields().entrySet()) {
            String name = h.getKey();
            if (name == null || h.getValue().isEmpty()) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.equals("set-cookie")) {
                for (String c : h.getValue()) cookies.setCookie(url, c);
                continue;
            }
            if (lower.equals("content-length") || lower.equals("content-encoding")
                    || lower.equals("transfer-encoding") || lower.equals("content-type")) {
                continue;
            }
            f.headers.put(lower, h.getValue().get(0));
        }

        String type = conn.getContentType();
        f.mime = "application/octet-stream";
        f.charset = Charset.forName("UTF-8");
        if (type != null) {
            String[] parts = type.split(";");
            f.mime = parts[0].trim().toLowerCase(Locale.ROOT);
            for (int i = 1; i < parts.length; i++) {
                String p = parts[i].trim();
                if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                    try {
                        f.charset = Charset.forName(p.substring(8).replace("\"", "").trim());
                    } catch (RuntimeException ignored) {
                        // Unknown charset: keep UTF-8.
                    }
                }
            }
        }
        conn.disconnect();
        return f;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = s.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }
}
