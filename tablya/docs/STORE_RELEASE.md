# Store release

**Status: NOT READY TO SUBMIT.** The app code satisfies the technical requirements listed below, but submission is blocked on items only the business can supply (see *Blockers*). Nothing here was submitted or built for a store from this environment (no Xcode / Android SDK / EAS credentials).

## Requirements verified for this release (checked 2026-10-11 against official sources — re-check before every submission)
* **Apple**: uploads must be built with **Xcode 26 / iOS 26 SDK** (in force since 2026-04-28) — [Apple: upcoming requirements](https://developer.apple.com/news/upcoming-requirements/). `eas.json` uses `"ios": { "image": "latest" }`; confirm the image ships Xcode 26 when you build.
* **Google Play**: new apps/updates must **target API 36 (Android 16)** from 2026-08-31 — [Android: target API requirement](https://developer.android.com/google/play/requirements/target-sdk). On large screens API 36 ignores orientation locks, so `app.json` uses `"orientation": "default"` and layouts are width-flexible. Run `npx expo-doctor` and confirm SDK 54's `targetSdkVersion` after `expo prebuild`.
* **Account deletion**: in-app flow exists (Profile → Delete my account → `DELETE /auth/account`, password-confirmed). Provide the same path on a web page and its URL in Play Console's Data safety form.
* **User-generated content** (reviews, kitchen/dish text, photos): report (kitchen, user, review, item, image), block (cook→customer), moderation queue with actions + audit, support contact — present. Add EULA/terms stating zero tolerance and a published contact.
* **Payments**: physical goods/food → external payment processor is allowed; **no In-App Purchase** needed. **Sign in with Apple** is only required when offering third-party social login — none is offered.
* **Permissions** (each requested at point of use, with purpose strings in `app.json`): location while in use; camera/photo library (cook uploads); notifications (after login). Blocked: `RECORD_AUDIO`, legacy storage permissions.
* `ITSAppUsesNonExemptEncryption=false` set (HTTPS only; confirm with your export-compliance advisor).

## Required before submission — **blockers**
1. Real **bundle identifier / package name** (placeholder `com.example.tablya`), Apple Developer + Google Play accounts, EAS project id (`expo.extra.eas.projectId`), APNs key / FCM credentials.
2. **Production payment gateway adapter** and its SDK in `PayStep` (without it card checkout is disabled in release builds; cash on delivery works).
3. Production email/SMS provider, object storage, API domain with TLS.
4. **Legal**: publish privacy policy + terms (drafts: `docs/legal/`, need counsel review), support URL, marketing URL (optional); company/seller details; food-safety/licensing policy for home cooks in your jurisdiction.
5. **Final branding**: icon/splash in `apps/mobile/assets` are generated placeholders (solid brand colour + "T"); replace with final artwork (1024×1024 icon, adaptive foreground). App name "Tablya" — confirm trademark clearance for your markets.
6. **Screenshots** for each required device size and language (EN + AR) — to be captured from release builds; web-render screenshots are not valid store assets.
7. **Review demo accounts**: create a customer and a verified cook on the production/staging backend with sample data and put credentials in App Store Connect "App Review Information" / Play "App access". (`npm run seed` creates demo users in non-production only.)
8. Penetration test + load test, backup/restore drill (see SECURITY.md / DEPLOYMENT.md).

## Listing content (drafts — edit freely)
* **Name**: Tablya — Homemade Food · **Subtitle (≤30)**: Home cooks, delivered
* **Short description (Play, ≤80)**: Order fresh home-cooked meals from kitchens near you.
* **Keywords (Apple, ≤100)**: homemade food,home cooks,meals,delivery,kitchen,arabic food,kabsa,catering
* **Category**: Food & Drink · **Languages**: English, Arabic
* **Age rating**: expect 12+/Teen because of user-generated content (reviews, photos); no alcohol/gambling/mature content. Answer the questionnaires honestly for your final content.
* **Content declarations**: UGC: yes (moderated, reportable). Ads: none. Government app: no. Financial features: no (payments for goods only).

## Privacy declarations (derive from [PRIVACY.md](PRIVACY.md))
| Apple "App Privacy" / Play "Data safety" category | Collected | Linked to user | Purpose | Shared with |
|---|---|---|---|---|
| Name, email, phone (optional) | yes | yes | account, app functionality, order contact | cook (first name/phone for active orders) |
| Precise/approximate location | yes (when used; not stored except saved addresses) | yes (saved addresses) | app functionality | cook (delivery address snapshot) |
| Purchase history (orders) | yes | yes | app functionality, accounting | kitchen |
| Photos (user-uploaded) | yes | yes | app functionality (menu/reviews/verification) | public (menu/review images); verification docs: admins only |
| User content (reviews, support messages) | yes | yes | app functionality | public (reviews) |
| Identifiers (device push token) | yes | yes | notifications | Expo push service (if enabled) |
| Diagnostics/analytics (event names, no PII) | yes | no | analytics | none |
| Payment info | **no** — handled entirely by the payment gateway | — | — | gateway |
Data is encrypted in transit (HTTPS); deletion available in-app. Update this table if you add an SDK (analytics, crash reporting, gateway).

## Build & submit (when blockers are cleared)
```bash
cd apps/mobile
npx expo-doctor
eas build --profile production --platform all
eas submit --profile production --platform ios      # then Android
```
Smoke-test the release build on real devices: login, deep link `tablya://order/<id>`, push, location prompt, camera/photos, account deletion, Arabic/RTL (native needs an app restart after switching language), offline banner, card payment sandbox → real gateway.
