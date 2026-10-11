package androidx.test.internal.runner.lifecycle;
import android.app.Activity;
import androidx.test.runner.lifecycle.ActivityLifecycleCallback;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitor;
import androidx.test.runner.lifecycle.Stage;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
public class ActivityLifecycleMonitorImpl implements ActivityLifecycleMonitor {
    private final List<ActivityLifecycleCallback> callbacks = new ArrayList<ActivityLifecycleCallback>();
    public void addLifecycleCallback(ActivityLifecycleCallback c) { callbacks.add(c); }
    public void removeLifecycleCallback(ActivityLifecycleCallback c) { callbacks.remove(c); }
    public Stage getLifecycleStageOf(Activity a) { return null; }
    public Collection<Activity> getActivitiesInStage(Stage s) { return new ArrayList<Activity>(); }
    public void signalLifecycleChange(Stage stage, Activity activity) {
        for (ActivityLifecycleCallback c : new ArrayList<ActivityLifecycleCallback>(callbacks)) c.onActivityLifecycleChanged(activity, stage);
    }
}
