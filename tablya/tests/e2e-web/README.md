# Browser smoke tests (manual / local)

These drive the **real admin console and the Expo web build** in Chromium against a **real API + seeded Postgres**.
They are not part of CI (they need running servers); they are how the UI flows were verified.

```bash
# 1. API (dev) + seed
npm run seed -w @tablya/api
# 2. start API on :3000 (CORS_ORIGINS must include http://localhost:5173 and :8081), admin on :5173, mobile web build on :8081
npx expo export --platform web   # in apps/mobile, then serve dist/ on :8081
# 3. create an always-open verified kitchen through the public API
node seed-open-kitchen.mjs        # prints kitchen name + cook email
# 4. run
npm i playwright-core             # in this folder; set executablePath inside scripts to your Chromium
node admin-smoke.js
node mobile-customer-journey.js "<kitchen name>"
node mobile-cook-flow.js <cook email>
node mobile-arabic-rtl.js
REQUIRE_ADMIN_MFA=true …          # start the API with this flag, then: node admin-mfa-setup.js
```
