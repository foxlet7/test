package androidx.test.espresso;
import java.util.ArrayList;
import java.util.Collection;
public final class IdlingRegistry {
    private static final IdlingRegistry INSTANCE = new IdlingRegistry();
    private IdlingRegistry() {}
    public static IdlingRegistry getInstance() { return INSTANCE; }
    public Collection<IdlingResource> getResources() { return new ArrayList<IdlingResource>(); }
    public Collection<android.os.Looper> getLoopers() { return new ArrayList<android.os.Looper>(); }
}
