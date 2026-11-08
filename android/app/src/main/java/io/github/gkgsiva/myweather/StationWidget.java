package io.github.gkgsiva.myweather;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Home-screen widget with the main Wunderground station's reading: temperature,
 * rain so far today, rain rate now and wind. The station and API key are the
 * ones the app's Home screen uses; the page sends them over when Home loads
 * (MainActivity "widgetStation" message), so the widget follows any change made
 * in the app. Android refreshes it every 30 minutes; ↻ reads it now; a tap opens
 * the app's Home screen.
 */
public class StationWidget extends AppWidgetProvider {
    private static final String PREFS = "station_widget";
    private static final String ACTION_REFRESH = "io.github.gkgsiva.myweather.STATION_WIDGET_REFRESH";
    private static final String DASH = "–";

    /** Saves the station picked in the app and refreshes the widgets if it changed. */
    static void setStation(Context context, String id, String name, String key) {
        if (id == null || !id.matches("[A-Z0-9]{3,20}") || key == null || key.isEmpty()) return;
        if (name == null || name.isEmpty()) name = id;
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (id.equals(p.getString("id", null)) && name.equals(p.getString("name", null))
                && key.equals(p.getString("key", null))) return;
        p.edit().putString("id", id).putString("name", name).putString("key", key).apply();
        context.sendBroadcast(new Intent(context, StationWidget.class).setAction(ACTION_REFRESH));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refresh(context, manager, ids);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            refresh(context, manager, manager.getAppWidgetIds(new ComponentName(context, StationWidget.class)));
        }
    }

    private void refresh(Context context, AppWidgetManager manager, int[] ids) {
        if (ids == null || ids.length == 0) return;
        final Context app = context.getApplicationContext();
        SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final String id = p.getString("id", null);
        final String name = p.getString("name", id);
        final String key = p.getString("key", null);
        if (id == null || key == null) {
            manager.updateAppWidget(ids, views(app, app.getString(R.string.station_widget_title),
                    null, app.getString(R.string.station_widget_setup)));
            return;
        }
        manager.updateAppWidget(ids, withStatus(app, p, name, app.getString(R.string.station_widget_loading)));

        final PendingResult result = goAsync();
        new Thread(() -> {
            RemoteViews rv;
            try {
                JSONObject obs = fetch(id, key);
                if (obs == null) {
                    rv = withStatus(app, p, name, app.getString(R.string.station_widget_offline));
                } else {
                    p.edit().putString("last", obs.toString()).apply();
                    rv = views(app, name, obs, null);
                }
            } catch (KeyException e) {
                rv = withStatus(app, p, name, app.getString(R.string.station_widget_bad_key));
            } catch (Exception e) {
                rv = withStatus(app, p, name, app.getString(R.string.station_widget_failed));
            }
            try {
                manager.updateAppWidget(ids, rv);
            } finally {
                result.finish();
            }
        }).start();
    }

    /** The last reading (if any) with a status line instead of its time. */
    private static RemoteViews withStatus(Context context, SharedPreferences p, String name, String status) {
        JSONObject last = null;
        try {
            String s = p.getString("last", null);
            if (s != null) last = new JSONObject(s);
        } catch (Exception ignored) {
        }
        return views(context, name, last, status);
    }

    private static RemoteViews views(Context context, String name, JSONObject obs, String status) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_station);
        rv.setTextViewText(R.id.station_name, name);

        JSONObject m = obs != null ? obs.optJSONObject("metric") : null;
        rv.setTextViewText(R.id.station_temp, num(m, "temp", 1) + "°");
        rv.setTextViewText(R.id.station_rain, num(m, "precipTotal", 1));
        rv.setTextViewText(R.id.station_rate, num(m, "precipRate", 1));
        String wind = num(m, "windSpeed", 0);
        if (obs != null && !obs.isNull("winddir")) wind += " " + compass(obs.optDouble("winddir"));
        rv.setTextViewText(R.id.station_wind, wind);
        String hum = obs != null && !obs.isNull("humidity")
                ? Math.round(obs.optDouble("humidity")) + "%" : DASH;
        rv.setTextViewText(R.id.station_humidity, hum);

        if (status == null) {
            long epoch = obs != null ? obs.optLong("epoch", 0) : 0;
            status = epoch > 0 ? context.getString(R.string.station_widget_at, formatIst(epoch * 1000)) : "";
        } else if (obs != null && obs.optLong("epoch", 0) > 0) {
            status = status + " · " + formatIst(obs.optLong("epoch") * 1000);
        }
        rv.setTextViewText(R.id.station_status, status);

        Intent open = new Intent(context, MainActivity.class)
                .putExtra(MainActivity.EXTRA_ROUTE, "#home")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        rv.setOnClickPendingIntent(R.id.station_body, PendingIntent.getActivity(context, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        Intent refresh = new Intent(context, StationWidget.class).setAction(ACTION_REFRESH);
        rv.setOnClickPendingIntent(R.id.station_refresh, PendingIntent.getBroadcast(context, 1, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return rv;
    }

    private static String num(JSONObject m, String field, int digits) {
        if (m == null || m.isNull(field)) return DASH;
        double v = m.optDouble(field, Double.NaN);
        if (Double.isNaN(v)) return DASH;
        return String.format(Locale.ENGLISH, "%." + digits + "f", v);
    }

    private static final String[] COMPASS = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};

    private static String compass(double deg) {
        return COMPASS[(int) (Math.round(deg / 45) % 8)];
    }

    private static final class KeyException extends Exception {
    }

    /** The station's current observation, or null when it is offline (HTTP 204/404). */
    private static JSONObject fetch(String id, String key) throws Exception {
        String url = "https://api.weather.com/v2/pws/observations/current?stationId=" + Uri.encode(id)
                + "&format=json&units=m&numericPrecision=decimal&apiKey=" + Uri.encode(key);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(15000);
        conn.setUseCaches(false);
        try {
            int code = conn.getResponseCode();
            if (code == 204 || code == 404) return null;
            if (code == 401 || code == 403) throw new KeyException();
            if (code != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + code);
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            }
            JSONArray list = new JSONObject(buf.toString("UTF-8")).optJSONArray("observations");
            return list != null && list.length() > 0 ? list.getJSONObject(0) : null;
        } finally {
            conn.disconnect();
        }
    }

    private static String formatIst(long millis) {
        SimpleDateFormat fmt = new SimpleDateFormat("h:mm a", Locale.ENGLISH);
        fmt.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return fmt.format(new Date(millis));
    }
}
