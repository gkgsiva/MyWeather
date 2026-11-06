package io.github.gkgsiva.myweather;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.View;
import android.widget.RemoteViews;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Home-screen widget with the latest IMD Chennai radar image (MAX (Z),
 * https://mausam.imd.gov.in/Radar/caz_cni.gif). Android refreshes it every
 * 30 minutes (updatePeriodMillis); the refresh button fetches it now, and a tap
 * on the image opens the radar page in the app.
 */
public class RadarWidget extends AppWidgetProvider {
    static final String CITY = "cni";
    static final String PRODUCT = "caz";
    static final String IMAGE_URL = "https://mausam.imd.gov.in/Radar/" + PRODUCT + "_" + CITY + ".gif";

    private static final String ACTION_REFRESH = "io.github.gkgsiva.myweather.RADAR_WIDGET_REFRESH";
    /** Keeps the bitmap well under the RemoteViews size limit. */
    private static final int MAX_WIDTH = 720;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refresh(context, manager, ids);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, RadarWidget.class));
            refresh(context, manager, ids);
        }
    }

    private void refresh(Context context, AppWidgetManager manager, int[] ids) {
        if (ids == null || ids.length == 0) return;
        final Context app = context.getApplicationContext();
        manager.updateAppWidget(ids, views(app, null, app.getString(R.string.widget_loading)));

        // goAsync keeps the broadcast alive while the image downloads off the main thread.
        final PendingResult result = goAsync();
        new Thread(() -> {
            RemoteViews rv;
            try {
                Fetched f = fetch();
                String time = f.lastModified > 0 ? formatIst(f.lastModified) : formatIst(System.currentTimeMillis());
                rv = views(app, f.bitmap, app.getString(R.string.widget_caption, time));
            } catch (Exception e) {
                rv = views(app, null, app.getString(R.string.widget_failed));
            }
            try {
                manager.updateAppWidget(ids, rv);
            } finally {
                result.finish();
            }
        }).start();
    }

    private static RemoteViews views(Context context, Bitmap bitmap, String caption) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_radar);
        rv.setTextViewText(R.id.widget_caption, caption);
        if (bitmap != null) {
            rv.setImageViewBitmap(R.id.widget_image, bitmap);
            rv.setViewVisibility(R.id.widget_image, View.VISIBLE);
        }

        Intent open = new Intent(context, MainActivity.class)
                .putExtra(MainActivity.EXTRA_ROUTE, "?city=" + CITY + "&product=" + PRODUCT + "#radar")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        rv.setOnClickPendingIntent(R.id.widget_image, PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        Intent refresh = new Intent(context, RadarWidget.class).setAction(ACTION_REFRESH);
        rv.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, 0, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return rv;
    }

    private static final class Fetched {
        Bitmap bitmap;
        long lastModified;
    }

    private static Fetched fetch() throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(IMAGE_URL).openConnection();
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(15000);
        conn.setUseCaches(false);
        try {
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new Exception("HTTP " + conn.getResponseCode());
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] chunk = new byte[16384];
                int n;
                while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            }
            byte[] bytes = buf.toByteArray();
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) throw new Exception("Not an image");
            if (bmp.getWidth() > MAX_WIDTH) {
                int h = Math.round(bmp.getHeight() * (MAX_WIDTH / (float) bmp.getWidth()));
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, MAX_WIDTH, h, true);
                bmp.recycle();
                bmp = scaled;
            }
            Fetched f = new Fetched();
            f.bitmap = bmp;
            f.lastModified = conn.getLastModified();
            return f;
        } finally {
            conn.disconnect();
        }
    }

    private static String formatIst(long millis) {
        SimpleDateFormat fmt = new SimpleDateFormat("d MMM, h:mm a", Locale.ENGLISH);
        fmt.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return fmt.format(new Date(millis)) + " IST";
    }
}
