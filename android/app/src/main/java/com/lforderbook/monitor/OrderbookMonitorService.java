package com.lforderbook.monitor;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.Context;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class OrderbookMonitorService extends Service {
    public static final String ACTION_STOP = "com.lforderbook.monitor.STOP";
    private static final String SETTINGS_URL = "https://lf-orderbook1.onrender.com/api/settings";
    private static final String BOOK_URL = "https://lf-orderbook1.onrender.com/api/orderbook";
    private static final String MONITOR_CHANNEL = "monitor_active_v2";
    private static final String ALERT_CHANNEL = "depth_alerts_v2";
    private static final int MONITOR_NOTIFICATION_ID = 41;
    private final Map<String, Long> lastAlert = new HashMap<>();
    private final Map<String, Long> lowSince = new HashMap<>();
    private final Map<String, ArrayDeque<Double>> depthSamples = new HashMap<>();
    private static final long REQUIRED_LOW_TIME_MS = 60_000L;
    private static final int MEDIAN_SAMPLE_COUNT = 5;
    private ScheduledExecutorService executor;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels(this);
        startForeground(MONITOR_NOTIFICATION_ID, monitoringNotification("Monitoring LF/USDT every 15 seconds"));
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::checkDepth, 2, 15, TimeUnit.SECONDS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getSharedPreferences("monitor", MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel monitor = new NotificationChannel(MONITOR_CHANNEL, "Orderbook monitoring", NotificationManager.IMPORTANCE_LOW);
        monitor.setDescription("Keeps LF/USDT depth monitoring active in the background");
        monitor.setSound(null, null);
        manager.createNotificationChannel(monitor);

        NotificationChannel alerts = new NotificationChannel(ALERT_CHANNEL, "Depth alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Sound and vibration when LF/USDT depth is below its target");
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[]{0, 250, 120, 250});
        alerts.setLightColor(Color.rgb(191, 255, 0));
        alerts.enableLights(true);
        alerts.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        manager.createNotificationChannel(alerts);
    }

    private Notification monitoringNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent openIntent = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, MonitorActionReceiver.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getBroadcast(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, MONITOR_CHANNEL) : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle("LF OrderBook monitoring active").setContentText(text).setContentIntent(openIntent).setOngoing(true).setCategory(Notification.CATEGORY_SERVICE).addAction(0, "Stop", stopIntent).build();
    }

    private void checkDepth() {
        try {
            JSONObject settings = fetchJson(SETTINGS_URL);
            if (settings.optBoolean("muted", false)) return;
            JSONObject book = fetchJson(BOOK_URL);
            JSONArray bids = book.getJSONArray("bids"), asks = book.getJSONArray("asks");
            double bid = bids.getJSONArray(0).getDouble(0), ask = asks.getJSONArray(0).getDouble(0), mid = (bid + ask) / 2d;
            double buy = medianDepth("buy", sumDepth(bids, mid, true));
            double sell = medianDepth("sell", sumDepth(asks, mid, false));
            double total = buy + sell;
            notifyIfLow("buy", buy, settings.getDouble("buy"));
            notifyIfLow("sell", sell, settings.getDouble("sell"));
            notifyIfLow("total", total, settings.getDouble("total"));
        } catch (Exception ignored) {
            // A later scheduled check retries automatically when connectivity returns.
        }
    }

    private double medianDepth(String side, double value) {
        ArrayDeque<Double> samples = depthSamples.get(side);
        if (samples == null) {
            samples = new ArrayDeque<>();
            depthSamples.put(side, samples);
        }
        samples.addLast(value);
        while (samples.size() > MEDIAN_SAMPLE_COUNT) samples.removeFirst();
        ArrayList<Double> sorted = new ArrayList<>(samples);
        Collections.sort(sorted);
        int middle = sorted.size() / 2;
        return sorted.size() % 2 == 1 ? sorted.get(middle) : (sorted.get(middle - 1) + sorted.get(middle)) / 2d;
    }

    private double sumDepth(JSONArray levels, double mid, boolean buy) throws Exception {
        double total = 0;
        for (int i = 0; i < levels.length(); i++) {
            JSONArray level = levels.getJSONArray(i);
            double price = level.getDouble(0), amount = level.getDouble(1);
            boolean inside = buy ? price >= mid * 0.98 && price <= mid : price >= mid && price <= mid * 1.02;
            if (inside) total += price * amount;
        }
        return total;
    }

    private void notifyIfLow(String side, double value, double target) {
        if (value >= target) {
            lastAlert.remove(side);
            lowSince.remove(side);
            return;
        }
        long now = System.currentTimeMillis();
        if (!lowSince.containsKey(side)) lowSince.put(side, now);
        if (now - lowSince.get(side) < REQUIRED_LOW_TIME_MS) return;
        long previous = lastAlert.containsKey(side) ? lastAlert.get(side) : 0;
        if (now - previous < 60_000) return;
        lastAlert.put(side, now);
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent openIntent = PendingIntent.getActivity(this, 10 + side.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, ALERT_CHANNEL) : new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        Notification notification = builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle("LF/USDT " + side.toUpperCase() + " depth alert").setContentText(String.format(java.util.Locale.US, "Current %.2f USDT · Target %.2f USDT", value, target)).setStyle(new Notification.BigTextStyle().bigText(String.format(java.util.Locale.US, "%s depth is below target. Current: %.2f USDT · Target: %.2f USDT · Shortage: %.2f USDT", side.toUpperCase(), value, target, target - value))).setContentIntent(openIntent).setAutoCancel(true).setCategory(Notification.CATEGORY_ALARM).build();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(100 + Math.abs(side.hashCode() % 50), notification);
    }

    private JSONObject fetchJson(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(12_000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "LFOrderBookAndroid/2.0");
        try {
            if (connection.getResponseCode() != 200) throw new Exception("HTTP " + connection.getResponseCode());
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
            reader.close();
            return new JSONObject(body.toString());
        } finally {
            connection.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
