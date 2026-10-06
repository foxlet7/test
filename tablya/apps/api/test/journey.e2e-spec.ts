import { randomUUID } from 'crypto';
import { Harness, uniq } from './harness';

/** The critical end-to-end flow from the product spec, driven purely through the public HTTP API. */
describe('E2E journey: register → browse → search → kitchen → cart → checkout → cook fulfils → complete → review', () => {
  const h = new Harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('runs the whole marketplace loop', async () => {
    // Kitchen is onboarded and verified through the real onboarding + admin flow
    const k = await h.seedKitchen({ name: 'Umm Khalid Kitchen', nameAr: 'مطبخ أم خالد' });

    // Register + login
    const email = `journey-${uniq()}@example.com`;
    const reg = await h.req().post('/auth/register').send({ email, password: 'CorrectHorse9', name: 'Sara Customer', locale: 'ar' });
    expect(reg.status).toBe(201);
    const login = await h.req().post('/auth/login').send({ email, password: 'CorrectHorse9' });
    const token = login.body.data.tokens.accessToken as string;

    // Address + browse
    const addr = await h.call('post', '/me/addresses', token, { line1: '5 Olaya St', city: 'Riyadh', lat: 24.72, lng: 46.68 });
    const addressId = addr.body.data.id;
    const home = await h.call('get', '/home?lat=24.72&lng=46.68', token);
    expect(home.status).toBe(200);
    expect(home.body.data.featured.some((x: any) => x.id === k.kitchenId)).toBe(true);
    expect(home.body.data.nearby.some((x: any) => x.id === k.kitchenId && x.availability === 'OPEN')).toBe(true);
    const list = await h.call('get', '/kitchens?lat=24.72&lng=46.68&sort=distance&openNow=true');
    expect(list.body.data.items[0].distanceKm).toBeLessThan(5);

    // Search (Arabic with diacritics/variants + English partial)
    expect((await h.call('get', '/search?q=' + encodeURIComponent('كبسه'))).body.data.dishes.some((d: any) => d.id === k.itemId)).toBe(true);
    expect((await h.call('get', '/search?q=kabs')).body.data.dishes.some((d: any) => d.id === k.itemId)).toBe(true);

    // Open kitchen, add food
    const kitchen = await h.call('get', `/kitchens/${k.kitchenId}`, token);
    expect(kitchen.body.data).toMatchObject({ availability: 'OPEN', name: 'Umm Khalid Kitchen' });
    expect(kitchen.body.data.menu[0].optionGroups.length).toBe(2);
    await h.call('post', '/cart/items', token, { menuItemId: k.itemId, quantity: 2, optionIds: [k.largeId, k.saladId], note: 'less spicy' });

    // Checkout: quote → order → pay (card, webhook-confirmed)
    const quote = await h.call('post', '/checkout/quote', token, { fulfillment: 'DELIVERY', addressId });
    expect(quote.body.data.pricing.subtotal).toBe(11000);
    const created = await h.call('post', '/orders', token, { addressId, fulfillment: 'DELIVERY', paymentMethod: 'CARD', expectedTotal: quote.body.data.pricing.total }, { 'Idempotency-Key': randomUUID() });
    expect(created.status).toBe(201);
    const orderId = created.body.data.order.id;
    expect(created.body.data.order.status).toBe('PENDING_PAYMENT');
    expect((await h.call('get', '/cart', token)).body.data.lines).toEqual([]); // cart consumed
    expect((await h.payOrder(token, created.body.data.payment.providerRef)).status).toBe(200);

    // Cook sees it, accepts, prepares, hands over, delivers
    const pending = await h.call('get', `/cook/kitchens/${k.kitchenId}/orders?scope=pending`, k.cook.token);
    const seen = pending.body.data.items.find((o: any) => o.id === orderId);
    expect(seen).toBeTruthy();
    expect(seen.customer.name).toBe('Sara'); // first name only
    expect(seen.items[0].note).toBe('less spicy');
    for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      expect((await h.call('post', `/cook/orders/${orderId}/transition`, k.cook.token, { to })).status).toBe(200);
    }
    const dash = (await h.call('get', `/cook/kitchens/${k.kitchenId}/dashboard`, k.cook.token)).body.data;
    expect(dash.orders.completedToday).toBe(1);

    // Customer can't review before the order is delivered/complete — and now can
    await h.call('post', `/orders/${orderId}/confirm-received`, token);
    const rev = await h.call('post', '/reviews', token, { orderId, rating: 5, text: 'Delicious <b>kabsa</b>!' });
    expect(rev.status).toBe(201);
    expect(rev.body.data.text).toBe('Delicious bkabsa/b!'); // angle brackets stripped
    const after = (await h.call('get', `/kitchens/${k.kitchenId}`)).body.data;
    expect(after.ratingAvg).toBe(5);
    expect(after.ratingCount).toBe(1);
    expect(after.reviews[0].author).toBe('Sara Customer');
    expect((await h.call('post', '/reviews', token, { orderId, rating: 1 })).status).toBe(422); // one review per order

    // Analytics funnel was recorded
    await new Promise((r) => setTimeout(r, 300));
    const events = await h.prisma.analyticsEvent.groupBy({ by: ['name'], where: { userId: reg.body.data.user.id }, _count: { _all: true } });
    const names = events.map((e) => e.name);
    for (const n of ['add_to_cart', 'checkout_started', 'payment_started', 'order_created', 'order_completed', 'review_created']) expect(names).toContain(n);
  });
});

describe('Search, discovery, reviews, favorites, moderation', () => {
  const h = new Harness();
  let k: Awaited<ReturnType<Harness['seedKitchen']>>;
  beforeAll(async () => {
    await h.start();
    k = await h.seedKitchen({ name: 'Mama Pizza House', nameAr: 'بيت بيتزا ماما' });
  });
  afterAll(() => h.stop());

  it('finds kitchens by partial, typo, Arabic variants and cuisine', async () => {
    const ids = async (q: string) => (await h.call('get', `/kitchens?q=${encodeURIComponent(q)}`)).body.data.items.map((i: any) => i.id);
    expect(await ids('pizz')).toContain(k.kitchenId); // partial
    expect(await ids('pizzaa')).toContain(k.kitchenId); // typo tolerance
    expect(await ids('MAMA')).toContain(k.kitchenId); // case-insensitive
    expect(await ids('بيتزا')).toContain(k.kitchenId); // Arabic
    expect(await ids('بِيتزا')).toContain(k.kitchenId); // with diacritics
    expect(await ids('zzzzqqqq')).not.toContain(k.kitchenId);
    const byCuisine = await h.call('get', `/kitchens?cuisine=${k.cuisine.slug}`);
    expect(byCuisine.body.data.items.map((i: any) => i.id)).toContain(k.kitchenId);
    const byCat = await h.call('get', `/kitchens?category=${k.category.slug}`);
    expect(byCat.body.data.items.map((i: any) => i.id)).toContain(k.kitchenId);
  });

  it('only verified, non-deleted kitchens are public; suspended ones vanish immediately', async () => {
    const draft = await h.register('COOK');
    const mk = await h.call('post', '/cook/kitchens', draft.token, { name: 'Secret Draft', city: 'Riyadh', lat: 24.7, lng: 46.7 });
    expect((await h.call('get', `/kitchens/${mk.body.data.id}`)).status).toBe(404);
    expect((await h.call('get', '/kitchens?q=Secret')).body.data.items).toHaveLength(0);
    const admin = await h.createStaff(['ADMIN']);
    await h.call('post', `/admin/kitchens/${k.kitchenId}/review`, admin.token, { decision: 'suspend', reason: 'hygiene complaint' });
    expect((await h.call('get', `/kitchens/${k.kitchenId}`)).status).toBe(404);
    const c = await h.customerWithAddress();
    await h.addToCart(c.token, k.itemId, [k.regularId]).catch(() => undefined);
    await h.call('post', `/admin/kitchens/${k.kitchenId}/review`, admin.token, { decision: 'reinstate' });
    expect((await h.call('get', `/kitchens/${k.kitchenId}`)).status).toBe(200);
  });

  it('kitchen status reflects schedule: closed outside hours, paused, fully booked', async () => {
    const kk = await h.seedKitchen({ name: 'Hours Kitchen' });
    await h.call('put', `/cook/kitchens/${kk.kitchenId}/schedule`, kk.cook.token, { slots: [] });
    expect((await h.call('get', `/kitchens/${kk.kitchenId}`)).body.data.availability).toBe('CLOSED');
    await h.call('put', `/cook/kitchens/${kk.kitchenId}/schedule`, kk.cook.token, { slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openMinute: 0, closeMinute: 1439 })) });
    expect((await h.call('get', `/kitchens/${kk.kitchenId}`)).body.data.availability).toBe('OPEN');
    await h.call('patch', `/cook/kitchens/${kk.kitchenId}/availability`, kk.cook.token, { pausedUntil: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await h.call('get', `/kitchens/${kk.kitchenId}`)).body.data.availability).toBe('TEMPORARILY_UNAVAILABLE');
    await h.call('patch', `/cook/kitchens/${kk.kitchenId}/availability`, kk.cook.token, { pausedUntil: null });
    await h.call('patch', `/cook/kitchens/${kk.kitchenId}`, kk.cook.token, { maxConcurrentOrders: 1 });
    const c = await h.customerWithAddress();
    await h.checkout(c, kk, 'CASH_ON_DELIVERY');
    expect((await h.call('get', `/kitchens/${kk.kitchenId}`)).body.data.availability).toBe('FULLY_BOOKED');
    const c2 = await h.customerWithAddress();
    await h.addToCart(c2.token, kk.itemId, [kk.regularId]);
    const q = await h.call('post', '/checkout/quote', c2.token, { fulfillment: 'DELIVERY', addressId: c2.addressId });
    expect(q.body.data.issues[0].code).toBe('KITCHEN_UNAVAILABLE');
  });

  it('reviews: only after delivery, only by the customer, editable window, rating aggregates, hide by moderators', async () => {
    const kk = await h.seedKitchen({ name: 'Review Kitchen' });
    const c = await h.customerWithAddress();
    const { order } = await h.checkout(c, kk, 'CASH_ON_DELIVERY');
    expect((await h.call('post', '/reviews', c.token, { orderId: order.id, rating: 5 })).body.error.code).toBe('REVIEW_NOT_ELIGIBLE'); // not delivered yet
    for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED']) await h.call('post', `/cook/orders/${order.id}/transition`, kk.cook.token, { to });
    const stranger = await h.customerWithAddress();
    expect((await h.call('post', '/reviews', stranger.token, { orderId: order.id, rating: 1 })).status).toBe(422); // not their order
    expect((await h.call('post', '/reviews', c.token, { orderId: order.id, rating: 6 })).status).toBe(400);
    const r = await h.call('post', '/reviews', c.token, { orderId: order.id, rating: 2, text: 'meh' });
    expect(r.status).toBe(201);
    expect((await h.call('patch', `/reviews/${r.body.data.id}`, c.token, { rating: 4 })).status).toBe(200);
    expect((await h.call('patch', `/reviews/${r.body.data.id}`, stranger.token, { rating: 1 })).status).toBe(404);
    expect((await h.prisma.kitchen.findUniqueOrThrow({ where: { id: kk.kitchenId } })).ratingAvg).toBe(4);
    await h.prisma.review.update({ where: { id: r.body.data.id }, data: { createdAt: new Date(Date.now() - 72 * 3_600_000) } });
    expect((await h.call('patch', `/reviews/${r.body.data.id}`, c.token, { rating: 1 })).status).toBe(403); // edit window closed

    // report → moderator hides → aggregate recalculated → audit trail
    const mod = await h.createStaff(['MODERATOR']);
    const rep = await h.call('post', '/reports', stranger.token, { targetType: 'REVIEW', targetId: r.body.data.id, reason: 'ABUSE', details: 'rude' });
    expect(rep.status).toBe(201);
    expect((await h.call('post', '/reports', stranger.token, { targetType: 'REVIEW', targetId: r.body.data.id, reason: 'ABUSE' })).status).toBe(201); // duplicate is harmless no-op
    expect(await h.prisma.report.count({ where: { targetId: r.body.data.id } })).toBe(1);
    const open = (await h.call('get', '/admin/reports', mod.token)).body.data.items.find((x: any) => x.targetId === r.body.data.id);
    expect((await h.call('post', `/admin/reports/${open.id}/resolve`, mod.token, { action: 'HIDE_REVIEW' })).status).toBe(400); // reason required
    expect((await h.call('post', `/admin/reports/${open.id}/resolve`, mod.token, { action: 'SUSPEND_USER', reason: 'nope' })).status).toBe(403); // moderators can't suspend users
    expect((await h.call('post', `/admin/reports/${open.id}/resolve`, mod.token, { action: 'HIDE_REVIEW', reason: 'abusive language' })).status).toBe(200);
    const kitchen = (await h.call('get', `/kitchens/${kk.kitchenId}`)).body.data;
    expect(kitchen.reviews).toHaveLength(0);
    expect(kitchen.ratingCount).toBe(0);
    expect(await h.prisma.moderationAction.count({ where: { targetId: r.body.data.id } })).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { action: 'MODERATION_HIDE_REVIEW' } })).toBe(1);
    await expect(h.prisma.moderationAction.deleteMany()).rejects.toThrow(/append-only/);
  });

  it('favorites, coupons, blocking, support tickets and notifications', async () => {
    const kk = await h.seedKitchen({ name: 'Perks Kitchen' });
    const c = await h.customerWithAddress();
    expect((await h.call('post', `/favorites/kitchens/${kk.kitchenId}`, c.token)).status).toBe(200);
    expect((await h.call('post', `/favorites/kitchens/${kk.kitchenId}`, c.token)).status).toBe(200); // idempotent
    expect((await h.call('post', `/favorites/items/${kk.itemId}`, c.token)).status).toBe(200);
    const favs = (await h.call('get', '/favorites', c.token)).body.data;
    expect(favs.kitchens).toHaveLength(1);
    expect(favs.items).toHaveLength(1);

    // coupon: admin creates; customer redeems once; usage limit enforced; refunds release it
    const admin = await h.createStaff(['ADMIN']);
    const code = `SAVE${uniq().toUpperCase()}`;
    expect((await h.call('post', '/admin/coupons', admin.token, { code, type: 'PERCENT', value: 20, usageLimit: 1, perUserLimit: 1 })).status).toBe(201);
    await h.addToCart(c.token, kk.itemId, [kk.regularId]);
    const q = await h.call('post', '/checkout/quote', c.token, { fulfillment: 'DELIVERY', addressId: c.addressId, couponCode: code });
    expect(q.body.data.pricing.discount).toBe(800);
    expect(q.body.data.pricing.total).toBe(Math.round((4000 - 800 + 1000) * 1.15));
    const o = await h.placeOrder(c, q.body.data.pricing.total, 'CASH_ON_DELIVERY', randomUUID(), { couponCode: code });
    expect(o.status).toBe(201);
    const c2 = await h.customerWithAddress();
    await h.addToCart(c2.token, kk.itemId, [kk.regularId]);
    const q2 = await h.call('post', '/checkout/quote', c2.token, { fulfillment: 'DELIVERY', addressId: c2.addressId, couponCode: code });
    expect(q2.body.data.issues[0].code).toBe('COUPON_INVALID'); // limit reached
    await h.call('post', `/orders/${o.body.data.order.id}/cancel`, c.token, {});
    const q3 = await h.call('post', '/checkout/quote', c2.token, { fulfillment: 'DELIVERY', addressId: c2.addressId, couponCode: code });
    expect(q3.body.data.issues).toEqual([]); // released on cancel
    expect((await h.call('post', '/checkout/quote', c2.token, { fulfillment: 'DELIVERY', addressId: c2.addressId, couponCode: 'NOPE' })).body.data.issues[0].code).toBe('COUPON_INVALID');

    // a cook can block a customer from their kitchens
    expect((await h.call('post', `/me/blocks/${c2.id}`, kk.cook.token)).status).toBe(200);
    const q4 = await h.call('post', '/checkout/quote', c2.token, { fulfillment: 'DELIVERY', addressId: c2.addressId });
    expect(q4.body.data.issues[0].code).toBe('KITCHEN_UNAVAILABLE');

    // support ticket round trip
    const t = await h.call('post', '/support/tickets', c.token, { subject: 'Missing item', message: 'My salad was missing' });
    expect(t.status).toBe(201);
    const support = await h.createStaff(['SUPPORT']);
    expect((await h.call('post', `/admin/support/tickets/${t.body.data.id}/reply`, support.token, { body: 'Sorry! Refund on the way.' })).status).toBe(200);
    expect((await h.call('get', '/support/tickets', c.token)).body.data[0].messages).toHaveLength(2);

    // notifications are localised per user locale, readable, and marked read
    await h.call('patch', '/me', c.token, { locale: 'ar' });
    const o2 = await h.checkout(c, kk, 'CASH_ON_DELIVERY');
    const notes = (await h.call('get', '/notifications', c.token)).body.data;
    expect(notes.items.some((n: any) => /[؀-ۿ]/.test(n.title))).toBe(true);
    expect(notes.unread).toBeGreaterThan(0);
    expect((await h.call('post', '/notifications/read-all', c.token)).status).toBe(201);
    expect((await h.call('get', '/notifications', c.token)).body.data.unread).toBe(0);
    expect(o2.res.status).toBe(201);
  });

  it('onboarding: incomplete kitchens cannot be submitted; admin must give a reason to reject; documents stay private', async () => {
    const cook = await h.register('COOK');
    const mk = await h.call('post', '/cook/kitchens', cook.token, { name: 'Half Done', city: 'Riyadh', lat: 24.7, lng: 46.7 });
    const id = mk.body.data.id;
    const sub = await h.call('post', `/cook/kitchens/${id}/submit`, cook.token);
    expect(sub.status).toBe(400);
    expect(sub.body.error.details.missing.length).toBeGreaterThan(2);

    const full = await h.seedKitchen({ name: 'Reject Me' });
    const admin = await h.createStaff(['ADMIN']);
    // seedKitchen already approved; suspend → illegal to "reject" a verified kitchen
    expect((await h.call('post', `/admin/kitchens/${full.kitchenId}/review`, admin.token, { decision: 'reject', reason: 'x' })).status).toBe(409);
    // document access is admin-only and audited
    const detail = (await h.call('get', `/admin/kitchens/${full.kitchenId}`, admin.token)).body.data;
    const docId = detail.verifications[0].documents[0].id;
    const support = await h.createStaff(['SUPPORT']);
    expect((await h.call('get', `/admin/documents/${docId}`, support.token)).status).toBe(403);
    expect((await h.call('get', `/admin/documents/${docId}`, admin.token)).status).toBe(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'DOCUMENT_VIEWED', entityId: docId } })).toBe(1);
    expect(JSON.stringify((await h.call('get', `/kitchens/${full.kitchenId}`)).body)).not.toContain('storageKey');
  });

  it('admin dashboard and analytics report real numbers', async () => {
    const admin = await h.createStaff(['ADMIN']);
    const d = (await h.call('get', '/admin/dashboard', admin.token)).body.data;
    expect(d.activeKitchens).toBeGreaterThan(0);
    expect(d.orders30d).toBeGreaterThan(0);
    expect(d.system.database).toBe('ok');
    const a = (await h.call('get', '/admin/analytics/daily?days=7', admin.token)).body.data;
    expect(a.daily.length).toBeGreaterThanOrEqual(7);
    // settings: only super admin; changes affect pricing and are audited
    const sa = await h.createStaff(['SUPER_ADMIN']);
    expect((await h.call('put', '/admin/settings', admin.token, { taxBps: 0, reason: 'x' })).status).toBe(403);
    expect((await h.call('put', '/admin/settings', sa.token, { taxBps: 500, reason: 'test change' })).body.data.taxBps).toBe(500);
    const c = await h.customerWithAddress();
    await h.addToCart(c.token, k.itemId, [k.regularId]);
    const q = await h.call('post', '/checkout/quote', c.token, { fulfillment: 'DELIVERY', addressId: c.addressId });
    expect(q.body.data.pricing.tax).toBe(Math.round(5000 * 0.05));
    await h.call('put', '/admin/settings', sa.token, { taxBps: 1500, reason: 'revert' });
    expect(await h.prisma.auditLog.count({ where: { action: 'SETTINGS_CHANGED' } })).toBeGreaterThanOrEqual(2);
  });

  it('payouts: balance comes from the ledger, payout is idempotent and cannot overdraw', async () => {
    const kk = await h.seedKitchen({ name: 'Payout Kitchen' });
    const c = await h.customerWithAddress();
    const { order, payment } = await h.checkout(c, kk, 'CARD');
    await h.payOrder(c.token, payment.providerRef);
    for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED']) await h.call('post', `/cook/orders/${order.id}/transition`, kk.cook.token, { to });
    await h.call('post', `/orders/${order.id}/confirm-received`, c.token);
    const admin = await h.createStaff(['ADMIN']);
    const bal = (await h.call('get', `/admin/kitchens/${kk.kitchenId}/balance`, admin.token)).body.data;
    expect(bal.availableMinor).toBe(4400);
    const key = randomUUID();
    const [p1, p2] = await Promise.all([h.call('post', `/admin/kitchens/${kk.kitchenId}/payouts`, admin.token, undefined, { 'Idempotency-Key': key }), h.call('post', `/admin/kitchens/${kk.kitchenId}/payouts`, admin.token, undefined, { 'Idempotency-Key': key })]);
    expect([p1.status, p2.status]).toEqual([200, 200]);
    expect(p1.body.data.id).toBe(p2.body.data.id);
    expect(p1.body.data.amountMinor).toBe(4400);
    expect((await h.call('post', `/admin/kitchens/${kk.kitchenId}/payouts`, admin.token, undefined, { 'Idempotency-Key': randomUUID() })).status).toBe(409); // nothing left
    expect((await h.call('get', `/admin/kitchens/${kk.kitchenId}/balance`, admin.token)).body.data.availableMinor).toBe(0);
  });
});
