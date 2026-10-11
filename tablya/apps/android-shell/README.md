# Android test shell (APK)

A small **native Android app** (Java, no Gradle/Expo cloud needed) that embeds the Tablya app's **Expo web build** and runs it inside a
WebView on the virtual origin `https://app.tablya.local`. It is for **testing the real UI and flows on a phone**.
It talks to **your own Tablya API**, which you enter on first launch.

> This is **not** the store build. The store build is the React Native binary (`apps/mobile` via EAS / `expo prebuild`), which needs the
> Android SDK + NDK. Differences in the shell: no push notifications, tokens kept in WebView localStorage (not Keystore), photo picking
> via the system file chooser, cleartext http allowed for LAN testing. Don't distribute it.

## Install
1. Copy `tablya-test.apk` to the phone (USB, Drive, `adb install tablya-test.apk`, or download it from the repo).
2. Open it. Android asks to allow **"Install unknown apps"** for your file manager/browser — allow it. Play Protect may warn about an unknown developer (test-signed build): choose *Install anyway*.
3. Min Android 5.0 (API 21); the APK carries v1+v2+v3 signatures so old and new phones can verify it.

## Run a backend the phone can reach
On a computer on the **same Wi-Fi** as the phone:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up --build
# API on :3000, Postgres seeded with demo data (dev only).
```
Find the computer's LAN address (`ipconfig` / `ifconfig` / `ip a`, e.g. `192.168.1.20`) and allow port 3000 through the firewall.
Sanity check from the phone's browser: `http://192.168.1.20:3000/health` → `{"status":"ok"…}`.

No Docker? Use the quick start in the root README (Postgres + `npm run seed` + `npm run start:dev`) — the API already listens on `0.0.0.0`.
The API must allow the shell's origin: `CORS_ORIGINS=https://app.tablya.local` (already set in the compose file).

## First launch
Enter `http://<computer-ip>:3000` when prompted. **Connect** first tests `GET /health` and, if it fails, tells you why (refused / timed out / unknown host) and offers *Save anyway*. Change it any time: **Server settings** on the welcome screen or Profile tab.
Demo logins (password `DemoPassw0rd!`): `customer@tablya.test`, `cook.fatima@tablya.test` (cook dashboard: Profile → Cook dashboard),
`admin@tablya.test` (use the admin web console, not the app). Seeded kitchens are open 09:00–23:00 **Asia/Riyadh time**; outside those hours they show as *Closed* (register a new cook/kitchen, or edit hours, to test at night).
Card payments use the **sandbox provider**: after "Place order" choose *Complete test payment*. Cash on delivery works without it.

## Rebuild
```bash
sudo apt-get install aapt apksigner zipalign dalvik-exchange default-jdk-headless   # Debian/Ubuntu
npm install && npm run build:shared
apps/android-shell/build.sh        # -> apps/android-shell/tablya-test.apk (debug-signed, v2/v3)
```
The script exports the web build, packages assets with `aapt`, compiles Java 8 with `javac`, dexes with `dx`, aligns and signs.
It creates `debug.keystore` on first run (git-ignored): **keep it**, otherwise a rebuilt APK has a different signature and Android won't update over the old install (uninstall first).

## Tests
`cd apps/android-shell/test && mvn -q test` runs the shell on the JVM with Robolectric against real Android 14 framework code:
first-run server prompt + validation, persistence, asset serving, SPA fallback, `/__config.js` injection and escaping, external-link handling.
(Includes tiny stand-ins for four `androidx.test` classes because the official AARs live only on Google's Maven.)
**Not verified:** installation and rendering on a physical device — this was built in a sandbox without Android hardware or an emulator.
