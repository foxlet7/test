package app.tablya.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Runs Android's own PackageParser over the built APK: reproduces "There was a problem parsing the package". */
@RunWith(RobolectricTestRunner.class)
public class ApkParseTest {
    private void check() {
        File apk = new File("../tablya-test.apk");
        Context ctx = RuntimeEnvironment.getApplication();
        PackageInfo info = ctx.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_ACTIVITIES | PackageManager.GET_PERMISSIONS);
        assertNotNull("Android failed to parse the APK", info);
        assertEquals("app.tablya.shell", info.packageName);
        assertNotNull(info.activities);
        assertEquals("app.tablya.shell.MainActivity", info.activities[0].name);
        assertNotNull(info.requestedPermissions);
        System.out.println("PARSED OK: " + info.packageName + " v" + info.versionName + " minSdk? activities=" + info.activities.length + " perms=" + info.requestedPermissions.length);
    }

    @Test @Config(sdk = 34) public void parsesOnAndroid14() { check(); }
    @Test @Config(sdk = 30) public void parsesOnAndroid11() { check(); }
    @Test @Config(sdk = 28) public void parsesOnAndroid9() { check(); }
}
