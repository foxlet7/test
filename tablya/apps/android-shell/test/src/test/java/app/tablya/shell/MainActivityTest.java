package app.tablya.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.AlertDialog;
import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.EditText;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;

/** Exercises the shell on the JVM against real Android framework code (no device available in CI). */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MainActivityTest {

    private static WebResourceRequest req(final String url) {
        return new WebResourceRequest() {
            public Uri getUrl() { return Uri.parse(url); }
            public boolean isForMainFrame() { return true; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return false; }
            public String getMethod() { return "GET"; }
            public Map<String, String> getRequestHeaders() { return Collections.emptyMap(); }
        };
    }

    private static String body(WebResourceResponse r) throws Exception {
        InputStream in = r.getData();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    /** Serves the staged web build (../build/assets) exactly like the APK's assets folder. */
    public static class DiskAssetsActivity extends MainActivity {
        @Override
        java.io.InputStream openAsset(String path) throws java.io.IOException {
            return new java.io.FileInputStream(new java.io.File("../build/assets/" + path));
        }
    }

    private MainActivity start() {
        return Robolectric.buildActivity(DiskAssetsActivity.class).create().start().resume().visible().get();
    }

    private WebView webOf(MainActivity a) throws Exception {
        java.lang.reflect.Field f = MainActivity.class.getDeclaredField("web");
        f.setAccessible(true);
        return (WebView) f.get(a);
    }

    private static void waitFor(java.util.concurrent.Callable<Boolean> cond) throws Exception {
        long end = System.currentTimeMillis() + 8000;
        while (System.currentTimeMillis() < end) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper();
            if (cond.call()) return;
            Thread.sleep(40);
        }
        throw new AssertionError("condition not met within 8s");
    }

    private static com.sun.net.httpserver.HttpServer healthServer(final int status) throws Exception {
        com.sun.net.httpserver.HttpServer srv = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/health", new com.sun.net.httpserver.HttpHandler() {
            public void handle(com.sun.net.httpserver.HttpExchange ex) throws java.io.IOException {
                byte[] b = "{\"status\":\"ok\"}".getBytes("UTF-8");
                ex.sendResponseHeaders(status, b.length);
                ex.getResponseBody().write(b);
                ex.close();
            }
        });
        srv.start();
        return srv;
    }

    @Test
    public void firstLaunchValidatesTheUrlThenTestsTheServerBeforeSaving() throws Exception {
        final MainActivity a = start();
        final AlertDialog d = ShadowAlertDialog.getLatestAlertDialog();
        assertNotNull("server dialog shown on first run", d);
        final EditText input = findEdit(d.getWindow().getDecorView());
        assertNotNull(input);
        final android.content.SharedPreferences prefs = a.getSharedPreferences("tablya_shell", Context.MODE_PRIVATE);

        // 1) malformed input never leaves the dialog
        input.setText("not-a-url");
        d.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
        assertTrue(d.isShowing());
        assertNotNull(input.getError());
        assertNull(prefs.getString("server", null));

        // 2) an unreachable server is reported with a reason and is NOT saved; "Save anyway" is offered
        input.setText("http://127.0.0.1:1/");
        d.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
        waitFor(new java.util.concurrent.Callable<Boolean>() {
            public Boolean call() { return d.getButton(AlertDialog.BUTTON_NEUTRAL).getVisibility() == android.view.View.VISIBLE; }
        });
        assertTrue(d.isShowing());
        assertNull("not saved after a failed test", prefs.getString("server", null));
        android.widget.TextView msg = (android.widget.TextView) d.findViewById(android.R.id.message);
        assertTrue(String.valueOf(msg.getText()), msg.getText().toString().contains("Connection refused"));

        d.getButton(AlertDialog.BUTTON_NEUTRAL).performClick();
        assertEquals("http://127.0.0.1:1", prefs.getString("server", null));
        assertEquals("https://app.tablya.local/index.html", shadowOf(webOf(a)).getLastLoadedUrl());
    }

    @Test
    public void reachableServerIsSavedAutomatically() throws Exception {
        com.sun.net.httpserver.HttpServer srv = healthServer(200);
        try {
            final MainActivity a = start();
            final AlertDialog d = ShadowAlertDialog.getLatestAlertDialog();
            EditText input = findEdit(d.getWindow().getDecorView());
            String url = "http://127.0.0.1:" + srv.getAddress().getPort() + "/";
            input.setText(url);
            d.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
            final android.content.SharedPreferences prefs = a.getSharedPreferences("tablya_shell", Context.MODE_PRIVATE);
            waitFor(new java.util.concurrent.Callable<Boolean>() {
                public Boolean call() { return prefs.getString("server", null) != null; }
            });
            assertEquals("http://127.0.0.1:" + srv.getAddress().getPort(), prefs.getString("server", null));
            assertEquals("https://app.tablya.local/index.html", shadowOf(webOf(a)).getLastLoadedUrl());
        } finally {
            srv.stop(0);
        }
    }

    @Test
    public void testServerExplainsEachFailureMode() throws Exception {
        assertNull(MainActivity.testServer(healthUrl(200)));
        assertTrue(MainActivity.testServer(healthUrl(404)).contains("HTTP 404"));
        assertTrue(MainActivity.testServer("http://127.0.0.1:1").contains("Connection refused"));
        assertTrue(MainActivity.testServer("http://no-such-host.invalid").contains("Unknown host"));
    }

    private String healthUrl(int status) throws Exception {
        com.sun.net.httpserver.HttpServer srv = healthServer(status);
        servers.add(srv);
        return "http://127.0.0.1:" + srv.getAddress().getPort();
    }

    private final java.util.List<com.sun.net.httpserver.HttpServer> servers = new java.util.ArrayList<com.sun.net.httpserver.HttpServer>();

    @org.junit.After
    public void stopServers() {
        for (com.sun.net.httpserver.HttpServer s : servers) s.stop(0);
    }

    private static EditText findEdit(android.view.View v) {
        if (v instanceof EditText) return (EditText) v;
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                EditText e = findEdit(g.getChildAt(i));
                if (e != null) return e;
            }
        }
        return null;
    }

    @Test
    public void servesBundledAppAndInjectsRuntimeConfig() throws Exception {
        MainActivity a = Robolectric.buildActivity(DiskAssetsActivity.class).get();
        a.getSharedPreferences("tablya_shell", Context.MODE_PRIVATE).edit().putString("server", "http://10.0.0.5:3000").commit();
        a = start();
        WebView web = webOf(a);
        assertEquals("known server -> app loads straight away", "https://app.tablya.local/index.html", shadowOf(web).getLastLoadedUrl());
        android.webkit.WebViewClient client = shadowOf(web).getWebViewClient();

        WebResourceResponse cfg = client.shouldInterceptRequest(web, req("https://app.tablya.local/__config.js"));
        assertEquals("application/javascript", cfg.getMimeType());
        assertEquals("window.__TABLYA_API_URL__=\"http://10.0.0.5:3000\";", body(cfg));

        WebResourceResponse index = client.shouldInterceptRequest(web, req("https://app.tablya.local/index.html"));
        String html = body(index);
        assertEquals("text/html", index.getMimeType());
        assertTrue("runtime config loads before the bundle", html.indexOf("/__config.js") > 0 && html.indexOf("/__config.js") < html.indexOf("_expo/static/js/web/entry-"));

        // single-page-app routes fall back to index.html
        assertEquals(html, body(client.shouldInterceptRequest(web, req("https://app.tablya.local/kitchen/123"))));
        assertEquals(html, body(client.shouldInterceptRequest(web, req("https://app.tablya.local/"))));

        // the JS bundle itself is served (underscore-prefixed dir survived packaging)
        java.io.File bundleDir = new java.io.File("../build/assets/www/_expo/static/js/web");
        String bundle = bundleDir.list()[0];
        WebResourceResponse js = client.shouldInterceptRequest(web, req("https://app.tablya.local/_expo/static/js/web/" + bundle));
        assertEquals("application/javascript", js.getMimeType());

        WebResourceResponse missing = client.shouldInterceptRequest(web, req("https://app.tablya.local/nope.png"));
        assertEquals(404, missing.getStatusCode());

        // API calls and other hosts are not intercepted
        assertNull(client.shouldInterceptRequest(web, req("http://10.0.0.5:3000/home")));
        assertNull(client.shouldInterceptRequest(web, req("https://example.com/x")));
    }

    @Test
    public void configStringIsEscapedAgainstScriptInjection() throws Exception {
        MainActivity a = Robolectric.buildActivity(DiskAssetsActivity.class).get();
        a.getSharedPreferences("tablya_shell", Context.MODE_PRIVATE).edit().putString("server", "http://x\";alert(1);//</script>").commit();
        a = start();
        WebView web = webOf(a);
        String js = body(shadowOf(web).getWebViewClient().shouldInterceptRequest(web, req("https://app.tablya.local/__config.js")));
        // quote and angle brackets are escaped, so the value can never break out of the string or the script tag
        assertEquals("window.__TABLYA_API_URL__=\"http://x\\\";alert(1);//\\u003c/script\\u003e\";", js);
    }

    @Test
    public void externalLinksLeaveTheApp() throws Exception {
        MainActivity a = Robolectric.buildActivity(DiskAssetsActivity.class).get();
        a.getSharedPreferences("tablya_shell", Context.MODE_PRIVATE).edit().putString("server", "http://10.0.0.5:3000").commit();
        a = start();
        WebView web = webOf(a);
        android.webkit.WebViewClient c = shadowOf(web).getWebViewClient();
        assertTrue(c.shouldOverrideUrlLoading(web, req("https://evil.example/phish")));
        assertEquals(false, c.shouldOverrideUrlLoading(web, req("https://app.tablya.local/login")));
    }
}
