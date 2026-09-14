package com.lforderbook.monitor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class MonitorActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!OrderbookMonitorService.ACTION_STOP.equals(intent.getAction())) return;
        context.getSharedPreferences("monitor", Context.MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
        context.stopService(new Intent(context, OrderbookMonitorService.class));
    }
}
