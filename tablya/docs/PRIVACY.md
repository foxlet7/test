# Privacy data map (what the code actually does)

| Data | Why | Stored where | Who can access | Retention / deletion |
|---|---|---|---|---|
| Name, email, password hash, optional phone, locale | account, login, order contact | `User` | the user; staff (support/admin); cooks see **first name + phone only while an order is active** | anonymised on account deletion (email/phone/hash nulled, name → "Deleted user") |
| Delivery addresses (+ coordinates) | delivery & coverage check | `Address`; snapshot on `Order.addressSnapshot` | the user; the cook of an active order sees the snapshot | addresses hard-deleted on account deletion; order snapshots nulled |
| Precise location | nearby kitchens, saving an address | device → sent as query params, **not stored** except in a saved address | — | not retained |
| Orders, items, totals | fulfilment, accounting, disputes | `Order*` | the customer, the kitchen, staff | **retained** (legal/financial) with personal data removed on deletion |
| Payments / refunds / ledger | accounting, reconciliation | `Payment*`, `Refund`, `LedgerEntry` | admins | retained per tax law (define period); no card numbers are ever stored here |
| Reviews | marketplace trust | `Review` | public (first name + last name as entered) | text kept, author shown as "Deleted user", images removed |
| Kitchen verification documents | verify home cooks | private storage + `KitchenDocument` | admins only (each view is audit-logged) | delete after decision per your policy (not automated yet) |
| Push tokens | notifications | `DeviceToken` | system | deleted on account deletion |
| Notifications | in-app inbox | `Notification` | the user | deleted on account deletion |
| Analytics events | funnel metrics | `AnalyticsEvent` | admins | no PII in props; `userId` nulled on deletion |
| Audit log | accountability | `AuditLog` (append-only) | admins | retained |
| Sessions | login | `RefreshToken` (hashed) | system | expired ones purged; all deleted on account deletion |

**Not collected:** contacts, photos beyond what the user explicitly uploads, advertising ID, background location, payment card data.
Permissions requested only at point of use: location (while in use), camera/photos (cook uploads), notifications (after login).
A privacy policy and terms are required before store submission — see `docs/legal/` templates (need legal review).
