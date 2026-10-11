package app.tablya.shell;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Test shell: hosts the Expo web build (bundled in assets/www) inside a WebView on a virtual https origin,
 * so the real app code runs on the phone. The backend URL is entered on first launch and can be changed later.
 * Not a production wrapper: see apps/android-shell/README.md.
 */
public class MainActivity extends Activity {
    private static final String HOST = "app.tablya.local";
    private static final String ORIGIN = "https://" + HOST;
    private static final String PREFS = "tablya_shell";
    private static final String KEY_SERVER = "server";
    private static final int REQ_LOCATION = 41;
    private static final int REQ_FILE = 42;

    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().setStatusBarColor(Color.parseColor("#B8420F"));

        web = new WebView(this);
        setContentView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        // https virtual origin -> http LAN API during tests
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setSupportZoom(false);

        web.addJavascriptInterface(new Bridge(), "TablyaShell");
        web.setWebViewClient(new ShellClient());
        web.setWebChromeClient(new ShellChrome());

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else if (getServer() == null) {
            promptServer(true);
        } else {
            web.loadUrl(ORIGIN + "/index.html");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    private String getServer() {
        return prefs.getString(KEY_SERVER, null);
    }

    /** Asks for the backend URL, e.g. http://192.168.1.20:3000 */
    private void promptServer(final boolean firstRun) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        String cur = getServer();
        input.setText(cur != null ? cur : "http://192.168.1.10:3000");
        input.setSelectAllOnFocus(true);

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("Tablya server")
                .setMessage("Address of the Tablya API reachable from this phone (same Wi-Fi as your computer), e.g. http://192.168.1.20:3000")
                .setView(input)
                .setCancelable(!firstRun)
                .setPositiveButton("Connect", null)
                .setNeutralButton("Save anyway", null);
        if (!firstRun) {
            b.setNegativeButton("Cancel", null);
        }
        final AlertDialog d = b.create();
        d.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface di) {
                final android.widget.Button connect = d.getButton(AlertDialog.BUTTON_POSITIVE);
                final android.widget.Button saveAnyway = d.getButton(AlertDialog.BUTTON_NEUTRAL);
                saveAnyway.setVisibility(android.view.View.GONE);
                saveAnyway.setOnClickListener(new android.view.View.OnClickListener() {
                    @Override
                    public void onClick(android.view.View v) {
                        applyServer(d, input.getText().toString());
                    }
                });
                connect.setOnClickListener(new android.view.View.OnClickListener() {
                    @Override
                    public void onClick(android.view.View v) {
                        final String url = normalizeUrl(input.getText().toString());
                        if (!url.startsWith("http://") && !url.startsWith("https://")) {
                            input.setError("Must start with http:// or https://");
                            return;
                        }
                        connect.setEnabled(false);
                        connect.setText("Testing…");
                        d.setMessage("Contacting " + url + "/health …");
                        new Thread(new Runnable() {
                            @Override
                            public void run() {
                                final String problem = testServer(url);
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        connect.setEnabled(true);
                                        connect.setText("Connect");
                                        if (problem == null) {
                                            applyServer(d, url);
                                        } else {
                                            d.setMessage("Cannot reach the server.\n\n" + problem);
                                            saveAnyway.setVisibility(android.view.View.VISIBLE);
                                        }
                                    }
                                });
                            }
                        }).start();
                    }
                });
            }
        });
        d.show();
    }

    private static String normalizeUrl(String raw) {
        String url = raw.trim();
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    private void applyServer(AlertDialog d, String raw) {
        String url = normalizeUrl(raw);
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return;
        }
        prefs.edit().putString(KEY_SERVER, url).apply();
        d.dismiss();
        web.clearCache(true);
        web.loadUrl(ORIGIN + "/index.html");
        Toast.makeText(MainActivity.this, "Server: " + url, Toast.LENGTH_SHORT).show();
    }

    /** Returns null when GET {url}/health answers 200, otherwise a human-readable reason and what to check. */
    static String testServer(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url + "/health").openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            int code = c.getResponseCode();
            if (code == 200) {
                return null;
            }
            return "A server answered at that address, but /health returned HTTP " + code
                    + ". Is that the Tablya API (port 3000) and not another program?";
        } catch (UnknownHostException e) {
            return "Unknown host. Check the address for typos.";
        } catch (ConnectException e) {
            return "Connection refused. The address is reachable but nothing is listening on that port: is the Tablya API running on your computer, and is the port right (default 3000)?";
        } catch (SocketTimeoutException e) {
            return "Timed out. Usually: the phone is on a different Wi-Fi/hotspot than the computer, the computer's firewall is blocking the port, or the IP is wrong.";
        } catch (NoRouteToHostException e) {
            return "No route to host. The phone and computer are on different networks (or Wi-Fi client isolation is on).";
        } catch (java.io.IOException e) {
            return "Network error: " + e.getMessage();
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    /** JavaScript bridge: only exposed to our own virtual origin (requests for other hosts are opened in the browser). */
    private class Bridge {
        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    promptServer(false);
                }
            });
        }

        @JavascriptInterface
        public String getServer() {
            String s = MainActivity.this.getServer();
            return s == null ? "" : s;
        }
    }

    private class ShellClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (!HOST.equals(u.getHost())) {
                return null; // API calls and anything else go to the network normally
            }
            String path = u.getPath() == null ? "/" : u.getPath();
            if (path.equals("/__config.js")) {
                String server = getServer() == null ? "" : getServer();
                String js = "window.__TABLYA_API_URL__=" + jsString(server) + ";";
                return respond("application/javascript", js.getBytes(java.nio.charset.Charset.forName("UTF-8")));
            }
            if (path.equals("/") || path.isEmpty()) {
                path = "/index.html";
            }
            try {
                return asset(path);
            } catch (IOException e) {
                // Single-page app: unknown route without a file extension -> index.html; unknown file -> 404
                String last = path.substring(path.lastIndexOf('/') + 1);
                if (last.indexOf('.') < 0) {
                    try {
                        return asset("/index.html");
                    } catch (IOException e2) {
                        // fall through
                    }
                }
                WebResourceResponse nf = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                nf.setStatusCodeAndReasonPhrase(404, "Not Found");
                return nf;
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (HOST.equals(u.getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) {
                // no handler
            }
            return true;
        }
    }

    private WebResourceResponse asset(String path) throws IOException {
        return new WebResourceResponse(mime(path), "utf-8", openAsset("www" + path));
    }

    /** Package-private so tests can serve the staged build output without an installed APK. */
    InputStream openAsset(String path) throws IOException {
        return getAssets().open(path);
    }

    private WebResourceResponse respond(String mime, byte[] body) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Cache-Control", "no-store");
        WebResourceResponse r = new WebResourceResponse(mime, "utf-8", new ByteArrayInputStream(body));
        r.setResponseHeaders(h);
        return r;
    }

    private static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c < 0x20 || c == '<' || c == '>') {
                b.append(String.format("\\u%04x", (int) c));
            } else {
                b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private class ShellChrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!ORIGIN.equals(origin)) {
                callback.invoke(origin, false, false);
                return;
            }
            if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
            } else {
                pendingGeoOrigin = origin;
                pendingGeoCallback = callback;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(null);
            }
            fileCallback = callback;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("image/*");
            try {
                startActivityForResult(Intent.createChooser(pick, "Choose a photo"), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_LOCATION && pendingGeoCallback != null) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            Uri[] uris = null;
            if (result == RESULT_OK && data != null && data.getData() != null) {
                uris = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
