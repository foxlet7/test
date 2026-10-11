#!/usr/bin/env bash
# Builds a debug-signed, installable test APK without Gradle/Android SDK:
#   Expo web export -> assets, aapt (manifest/resources), javac (Java 8), dx (dex), zipalign, apksigner.
# Requirements (Debian/Ubuntu): sudo apt-get install aapt apksigner zipalign dalvik-exchange default-jdk-headless
# Framework jar: tools/android.jar (API 34) — downloaded on first run.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
OUT=$HERE/build
APK_NAME=${APK_NAME:-tablya-test.apk}

for t in aapt apksigner zipalign dalvik-exchange javac keytool node; do
  command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }
done

if [ ! -s tools/android.jar ]; then
  mkdir -p tools
  echo "→ downloading android.jar (API 34)"
  curl -fL -o tools/android.jar https://raw.githubusercontent.com/Reginer/aosp-android-jar/main/android-34/android.jar
fi

echo "→ exporting the Expo web build"
(cd ../mobile && npx expo export --platform web >/dev/null)

rm -rf "$OUT" && mkdir -p "$OUT/assets" "$OUT/classes"
cp -r ../mobile/dist "$OUT/assets/www"
# runtime config (server URL) is served by the shell at /__config.js and must load before the app bundle
python3 - "$OUT/assets/www/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
tag = '<script src="/__config.js"></script>'
assert "<head>" in s, "unexpected index.html"
open(p, "w", encoding="utf-8").write(s.replace("<head>", "<head>" + tag, 1))
PY

echo "→ packaging manifest, resources and assets (aapt)"
aapt package -f -M AndroidManifest.xml -S res -A "$OUT/assets" -I tools/android.jar \
  --min-sdk-version 24 --target-sdk-version 34 --ignore-assets '!.svn:!.git' -F "$OUT/base.apk"

echo "→ compiling Java"
javac -Xlint:-options --release 8 -cp tools/android.jar -d "$OUT/classes" $(find src -name '*.java')

echo "→ dexing"
dalvik-exchange --dex --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add base.apk classes.dex >/dev/null)

echo "→ aligning and signing"
zipalign -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
KS=$HERE/debug.keystore
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias tablya-test \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Tablya Test, O=Tablya, C=SA" >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --ks-key-alias tablya-test \
  --out "$HERE/$APK_NAME" "$OUT/aligned.apk"

echo "→ verifying"
apksigner verify --verbose "$HERE/$APK_NAME" | grep -E "Verifies|v[123] scheme|Number of signers"
zipalign -c -p 4 "$HERE/$APK_NAME" && echo "zipalign: OK"
aapt dump badging "$HERE/$APK_NAME" | grep -E "^package:|sdkVersion|targetSdk|launchable|uses-permission"
ls -lh "$HERE/$APK_NAME"
