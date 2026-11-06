package io.github.gkgsiva.myweather;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;

/**
 * Hosts the MyWeather web app in a WebView. The bundled files are served from
 * https://appassets.androidplatform.net/ so ES modules and localStorage work as
 * they do on the website.
 *
 * Wunderground and the Kea blog open inside the app, in a frame under the
 * MyWeather menu (see FrameProxy), with requests to common ad servers blocked
 * and leftover ad slots hidden. Links to any other site open in the browser.
 */
public class MainActivity extends Activity {
    private static final String APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String START_URL = "https://" + APP_HOST + "/assets/www/index.html";

    /** Optional query/hash to open, e.g. "?city=cni&product=caz#radar" from the radar widget. */
    static final String EXTRA_ROUTE = "io.github.gkgsiva.myweather.ROUTE";

    /** Sites shown inside the app rather than in the browser. */
    private static final String[] IN_APP_HOSTS = {
            "wunderground.com", "kwschennai.com", "cmwssb.tn.gov.in", "chennaimetrowater.tn.gov.in",
            "airquality.cpcb.gov.in"};

    /** Ad and ad-tracking servers whose requests get an empty response. */
    private static final String[] AD_HOSTS = {
            "doubleclick.net", "googlesyndication.com", "googleadservices.com",
            "adservice.google.com", "googletagservices.com", "pagead2.googlesyndication.com",
            "amazon-adsystem.com", "adnxs.com", "rubiconproject.com", "pubmatic.com",
            "openx.net", "casalemedia.com", "indexww.com", "criteo.com", "criteo.net",
            "taboola.com", "outbrain.com", "moatads.com", "adsafeprotected.com",
            "doubleverify.com", "teads.tv", "smartadserver.com", "3lift.com",
            "sharethrough.com", "yieldmo.com", "media.net", "adsrvr.org",
            "bidswitch.net", "contextweb.com", "lijit.com", "sovrn.com",
            "gumgum.com", "33across.com", "connatix.com", "primis.tech",
            "scorecardresearch.com", "quantserve.com", "ezoic.net", "ezojs.com",
            "mediavine.com", "adthrive.com", "pubfig.com", "confiant-integrations.net",
    };

    /** CSS hiding ad slots that remain empty once their ad requests are blocked. */
    private static final String HIDE_ADS_CSS = "ins.adsbygoogle,[id^='google_ads'],[id^='div-gpt-ad'],"
            + "[data-google-query-id],iframe[src*='doubleclick'],"
            + ".ad-mrec,.adsbygoogle,[class*='taboola'],"
            + "ad-slot,.ad-slot-frame,.house-ad,.house-ad-fallback,.bottom-ads"
            + "{display:none!important}";

    /** Adds HIDE_ADS_CSS to a page opened full screen. */
    private static final String HIDE_ADS_JS = "(function(){"
            + "if(document.getElementById('myweather-noads'))return;"
            + "var s=document.createElement('style');s.id='myweather-noads';"
            + "s.textContent=\"" + HIDE_ADS_CSS + "\";"
            + "(document.head||document.documentElement).appendChild(s);})();";

    /** IMD's warning feed, read by the Warnings screen; it sends no CORS header. */
    private static final String IMD_GEOSERVER_HOST = "reactjs.imd.gov.in";

    /**
     * IMD's main site: radar images (kept on the phone for offline use), the
     * cyclone page and the rainfall pages the Monsoon screen reads.
     */
    private static final String IMD_HOST = "mausam.imd.gov.in";

    /** Chennai Metro Water, whose lake-level page the Lakes screen reads. */
    private static final String[] LAKE_HOSTS = {"cmwssb.tn.gov.in", "chennaimetrowater.tn.gov.in"};

    /** Requests the page reads with fetch(), which need a CORS header added. */
    private static boolean needsCors(Uri url) {
        String host = url.getHost();
        String path = url.getPath() == null ? "" : url.getPath();
        if (IMD_GEOSERVER_HOST.equals(host)) return path.contains("/ows");
        if (IMD_HOST.equals(host)) {
            return path.startsWith("/Radar/") || path.equals("/responsive/cycloneinformation.php")
                    || path.startsWith("/responsive/rainfallinformation");
        }
        return hostMatches(host, LAKE_HOSTS);
    }

    /** OpenStreetMap's tile server, used by the station map. */
    private static final String OSM_TILE_HOST = "tile.openstreetmap.org";

    /** How the app names itself to OpenStreetMap (its tile policy asks apps to). */
    private static final String MAP_USER_AGENT =
            "MyWeather-Android/1 (https://github.com/gkgsiva/myweather)";

    private WebView webView;

    private static boolean hostMatches(String host, String[] domains) {
        if (host == null) return false;
        for (String d : domains) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        return false;
    }

    /** A page (not a script, image or data request), judged by the Accept header. */
    private static boolean isDocument(WebResourceRequest request) {
        for (java.util.Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
            if ("accept".equalsIgnoreCase(h.getKey())) return h.getValue().contains("text/html");
        }
        return false;
    }

    /**
     * Android 15 draws apps edge to edge, under the status bar and the
     * navigation bar, so the header's menu button ended up under the clock.
     * This keeps the WebView between the two bars and paints the strip behind
     * the status bar in the header colour (statusBarColor in styles.xml).
     */
    private View fitBelowSystemBars(View content) {
        final FrameLayout root = new FrameLayout(this);
        final View statusBarBg = new View(this);
        // Read from the theme: on Android 15 the window reports a transparent status bar.
        android.content.res.TypedArray a = obtainStyledAttributes(new int[]{android.R.attr.statusBarColor});
        statusBarBg.setBackgroundColor(a.getColor(0, 0xff1565c0));
        a.recycle();
        root.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(statusBarBg, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) content.getLayoutParams();
            lp.setMargins(left, top, right, bottom);
            content.setLayoutParams(lp);
            ViewGroup.LayoutParams sb = statusBarBg.getLayoutParams();
            sb.height = top;
            statusBarBg.setLayoutParams(sb);
            return insets;
        });
        return root;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(fitBelowSystemBars(webView));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if (hostMatches(host, AD_HOSTS)) {
                    return new WebResourceResponse("text/plain", "utf-8",
                            new ByteArrayInputStream(new byte[0]));
                }
                boolean get = "GET".equalsIgnoreCase(request.getMethod());
                // Station map tiles, with the app's own User-Agent.
                if (get && OSM_TILE_HOST.equals(host)) {
                    return FrameProxy.withUserAgent(request, MAP_USER_AGENT);
                }
                // Data the page reads itself; isDocument() is false for fetch().
                if (get && needsCors(request.getUrl()) && !isDocument(request)) {
                    return FrameProxy.withCors(request);
                }
                // Wunderground or the blog in a frame under the app's menu.
                if (get && !request.isForMainFrame() && hostMatches(host, IN_APP_HOSTS)
                        && isDocument(request)) {
                    return FrameProxy.frameDocument(request, HIDE_ADS_CSS);
                }
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (hostMatches(Uri.parse(url).getHost(), IN_APP_HOSTS)) {
                    view.evaluateJavascript(HIDE_ADS_JS, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // Links inside a framed page stay in the frame.
                if (!request.isForMainFrame() && hostMatches(uri.getHost(), IN_APP_HOSTS)) {
                    return false;
                }
                if (APP_HOST.equals(uri.getHost()) || hostMatches(uri.getHost(), IN_APP_HOSTS)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // No browser installed; stay on the page.
                }
                return true;
            }
        });

        String route = getIntent().getStringExtra(EXTRA_ROUTE);
        if (route != null) {
            webView.loadUrl(START_URL + route);
        } else if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String route = intent.getStringExtra(EXTRA_ROUTE);
        if (route != null) webView.loadUrl(START_URL + route);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
