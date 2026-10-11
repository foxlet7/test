package app.tablya.diag;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.widget.TextView;

public class Main extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        TextView t = new TextView(this);
        t.setTextSize(20);
        t.setPadding(48, 96, 48, 48);
        t.setText("Tablya diagnostic APK installed OK.\nAndroid " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")\n" + Build.MANUFACTURER + " " + Build.MODEL);
        setContentView(t);
    }
}
