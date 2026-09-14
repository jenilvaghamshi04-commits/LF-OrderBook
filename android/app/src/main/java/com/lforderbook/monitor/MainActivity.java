package com.lforderbook.monitor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String MONITOR_URL = "https://lf-orderbook1.onrender.com/?app=android&release=12";
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(6, 8, 6));
        window.setNavigationBarColor(Color.rgb(6, 8, 6));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(6, 8, 6));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(6, 8, 6));

        TextView offline = new TextView(this);
        offline.setText("LF OrderBook\n\nUnable to connect. Tap to retry.");
        offline.setTextColor(Color.WHITE);
        offline.setTextSize(17);
        offline.setGravity(android.view.Gravity.CENTER);
        offline.setVisibility(View.GONE);
        offline.setOnClickListener(v -> {
            offline.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            webView.reload();
        });

        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        getSharedPreferences("monitor", MODE_PRIVATE).edit().putBoolean("enabled", true).apply();
        Intent monitorIntent = new Intent(this, OrderbookMonitorService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(monitorIntent);
        else startService(monitorIntent);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " LFOrderBookAndroid/2.0");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                offline.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    webView.setVisibility(View.GONE);
                    offline.setVisibility(View.VISIBLE);
                }
            }
        });

        if (savedInstanceState == null) webView.loadUrl(MONITOR_URL);
        else webView.restoreState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
