package androidx.test.platform.app;

import android.app.Instrumentation;
import android.os.Bundle;

/**
 * Minimal stand-in for androidx.test.platform.app.InstrumentationRegistry (the real AAR is only published on Google's Maven,
 * which is unreachable in some CI sandboxes). Robolectric registers/reads it at bootstrap; plain Activity tests need nothing more.
 */
public final class InstrumentationRegistry {
    private static Instrumentation instance;
    private static Bundle arguments;

    private InstrumentationRegistry() {}

    public static void registerInstance(Instrumentation instrumentation, Bundle args) {
        instance = instrumentation;
        arguments = args;
    }

    public static Instrumentation getInstrumentation() {
        if (instance == null) throw new IllegalStateException("No instrumentation registered");
        return instance;
    }

    public static Bundle getArguments() {
        return arguments == null ? new Bundle() : new Bundle(arguments);
    }
}
