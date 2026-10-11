/** Bridge exposed by the Android test shell (apps/android-shell). Undefined in normal browsers and native builds. */
interface ShellBridge {
  changeServer(): void;
  getServer(): string;
}
export const shell = (globalThis as { TablyaShell?: ShellBridge }).TablyaShell;
