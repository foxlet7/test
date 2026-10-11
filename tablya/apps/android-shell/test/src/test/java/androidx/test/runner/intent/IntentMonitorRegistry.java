package androidx.test.runner.intent;
public final class IntentMonitorRegistry {
    private static IntentMonitor instance;
    private IntentMonitorRegistry() {}
    public static IntentMonitor getInstance() { return instance; }
    public static void registerInstance(IntentMonitor m) { instance = m; }
}
