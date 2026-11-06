package io.github.gkgsiva.myweather;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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
 * Wunderground and the Kea blog open inside the app (the Back button returns to
 * MyWeather), with requests to common ad servers blocked and leftover ad slots
 * hidden. Links to any other site open in the browser.
 */
public class MainActivity extends Activity {
    private static final String APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String START_URL = "https://" + APP_HOST + "/assets/www/index.html";

    /** Optional query/hash to open, e.g. "?city=cni&product=caz#radar" from the radar widget. */
    static final String EXTRA_ROUTE = "io.github.gkgsiva.myweather.ROUTE";

    /** Sites shown inside the app rather than in the browser. */
    private static final String[] IN_APP_HOSTS = {"wunderground.com", "kwschennai.com"};

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

    /** Hides ad slots that remain empty once their ad requests are blocked. */
    private static final String HIDE_ADS_JS = "(function(){"
            + "if(document.getElementById('myweather-noads'))return;"
            + "var s=document.createElement('style');s.id='myweather-noads';"
            + "s.textContent='ins.adsbygoogle,[id^=\\'google_ads\\'],[id^=\\'div-gpt-ad\\'],"
            + "[data-google-query-id],iframe[src*=\\'doubleclick\\'],"
            + ".ad-mrec,.adsbygoogle,[class*=\\'taboola\\'],"
            + "ad-slot,.ad-slot-frame,.house-ad,.house-ad-fallback,.bottom-ads"
            + "{display:none!important}';"
            + "(document.head||document.documentElement).appendChild(s);})();";

    private WebView webView;

    private static boolean hostMatches(String host, String[] domains) {
        if (host == null) return false;
        for (String d : domains) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        return false;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (hostMatches(request.getUrl().getHost(), AD_HOSTS)) {
                    return new WebResourceResponse("text/plain", "utf-8",
                            new ByteArrayInputStream(new byte[0]));
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
