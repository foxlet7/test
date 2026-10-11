// Creates a verified, always-open kitchen via the public API (same path real users take).
const B = 'http://localhost:3000';
const j = async (m, p, t, body, h = {}) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }); const x = await r.json(); if (!x.success) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(x.error)}`); return x.data; };
const sfx = Math.random().toString(36).slice(2, 7);
const cook = await j('POST', '/auth/register', null, { email: `e2e-cook-${sfx}@example.com`, password: 'CorrectHorse9', name: 'E2E Cook', role: 'COOK' });
const admin = await j('POST', '/auth/login', null, { email: 'admin@tablya.test', password: 'DemoPassw0rd!' });
import { readFileSync } from 'node:fs'; const png = Buffer.from(readFileSync(new URL('./good.b64', import.meta.url), 'utf8'), 'base64'); const bad = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAAAXklEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4GgPeAAGnTvB5AAAAAElFTkSuQmCC', 'base64'); { const f = new FormData(); f.append('purpose','kitchen'); f.append('file', new Blob([bad]), 'a.png'); const r = await fetch(B + '/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + cook.tokens.accessToken }, body: f }); console.log('corrupt png upload ->', r.status); }
async function upload(purpose) { const f = new FormData(); f.append('purpose', purpose); f.append('file', new Blob([png], { type: 'image/png' }), 'a.png'); const r = await fetch(B + '/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + cook.tokens.accessToken }, body: f }); const x = await r.json(); if (!x.success) throw new Error(JSON.stringify(x)); return x.data.key; }
const cuisines = await j('GET', '/cuisines');
const k = await j('POST', '/cook/kitchens', cook.tokens.accessToken, { name: `E2E Kitchen ${sfx}`, nameAr: 'مطبخ تجريبي', description: 'Fresh kabsa daily', city: 'Riyadh', lat: 24.7136, lng: 46.6753, cuisineIds: [cuisines[0].id], coverKey: await upload('kitchen') });
await j('PUT', `/cook/kitchens/${k.id}/schedule`, cook.tokens.accessToken, { slots: [0,1,2,3,4,5,6].map((d) => ({ dayOfWeek: d, openMinute: 0, closeMinute: 1439 })) });
await j('PUT', `/cook/kitchens/${k.id}/zones`, cook.tokens.accessToken, { zones: [{ name: 'Near', maxKm: 50, feeMinor: 1000, etaMinutes: 20 }] });
await j('POST', `/cook/kitchens/${k.id}/menu`, cook.tokens.accessToken, { name: 'Chicken Kabsa', nameAr: 'كبسة دجاج', priceMinor: 4000, description: 'Spiced rice with chicken', optionGroups: [{ name: 'Size', type: 'VARIATION', required: true, minSelect: 1, maxSelect: 1, options: [{ name: 'Regular' }, { name: 'Large', priceDeltaMinor: 1000 }] }] });
await j('POST', `/cook/kitchens/${k.id}/documents`, cook.tokens.accessToken, { type: 'NATIONAL_ID', key: await upload('verification_doc') });
await j('POST', `/cook/kitchens/${k.id}/submit`, cook.tokens.accessToken);
await j('POST', `/admin/kitchens/${k.id}/review`, admin.tokens.accessToken, { decision: 'start_review' });
await j('POST', `/admin/kitchens/${k.id}/review`, admin.tokens.accessToken, { decision: 'approve' });
console.log(JSON.stringify({ kitchenId: k.id, name: `E2E Kitchen ${sfx}`, cookEmail: `e2e-cook-${sfx}@example.com` }));
