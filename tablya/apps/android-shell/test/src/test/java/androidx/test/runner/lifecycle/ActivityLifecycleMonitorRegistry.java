package androidx.test.runner.lifecycle;
public final class ActivityLifecycleMonitorRegistry {
    private static ActivityLifecycleMonitor instance;
    private ActivityLifecycleMonitorRegistry() {}
    public static ActivityLifecycleMonitor getInstance() { return instance; }
    public static void registerInstance(ActivityLifecycleMonitor monitor) { instance = monitor; }
}
