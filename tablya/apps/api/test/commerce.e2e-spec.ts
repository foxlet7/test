import { randomUUID } from 'crypto';
import { Harness } from './harness';

describe('Checkout, payments, order lifecycle, refunds, ledger', () => {
  const h = new Harness();
  let k: Awaited<ReturnType<Harness['seedKitchen']>>;
  beforeAll(async () => {
    await h.start();
    k = await h.seedKitchen();
  });
  afterAll(() => h.stop());

  const orderRow = (id: string) => h.prisma.order.findUniqueOrThrow({ where: { id } });

  describe('pricing & validation (server is authoritative)', () => {
    it('prices options server-side: ignores any client-supplied price', async () => {
      const c = await h.customerWithAddress();
      const res = await h.call('post', '/cart/items', c.token, {
        menuItemId: k.itemId,
        quantity: 2,
        optionIds: [k.largeId, k.saladId],
        priceMinor: 1,
        unitPriceMinor: 1,
      });
      expect(res.status).toBe(201);
      const line = res.body.data.lines[0];
      expect(line.unitPriceMinor).toBe(4000 + 1000 + 500);
      expect(res.body.data.pricing.subtotal).toBe(11000);
    });

    it('quote totals: delivery zone fee + 15% tax, integers only', async () => {
      const c = await h.customerWithAddress(24.72, 46.68); // ~1 km => Near zone (fee 1000)
      await h.addToCart(c.token, k.itemId, [k.regularId]);
      const q = await h.call('post', '/checkout/quote', c.token, {
        fulfillment: 'DELIVERY',
        addressId: c.addressId,
      });
      expect(q.body.data.pricing).toMatchObject({
        subtotal: 4000,
        deliveryFee: 1000,
        tax: 750,
        total: 5750,
      });
      expect(q.body.data.issues).toEqual([]);
    });

    it('rejects required-option violations and foreign options', async () => {
      const c = await h.customerWithAddress();
      const noSize = await h.addToCart(c.token, k.itemId, []);
      expect(noSize.body.data.issues.map((i: any) => i.code)).toContain('VALIDATION_FAILED');
      const other = await h.seedKitchen({ name: 'Other' });
      const c2 = await h.customerWithAddress();
      const foreign = await h.addToCart(c2.token, k.itemId, [k.regularId, other.regularId]);
      expect(foreign.body.data.issues.length).toBeGreaterThan(0);
    });

    it('out-of-zone addresses are refused', async () => {
      const far = await h.customerWithAddress(25.9, 47.9); // >100 km away
      await h.addToCart(far.token, k.itemId, [k.regularId]);
      const q = await h.call('post', '/checkout/quote', far.token, {
        fulfillment: 'DELIVERY',
        addressId: far.addressId,
      });
      expect(q.body.data.issues[0].code).toBe('OUT_OF_DELIVERY_ZONE');
      const res = await h.placeOrder(far, 1, 'CARD');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('OUT_OF_DELIVERY_ZONE');
    });

    it('carts cannot mix kitchens unless explicitly replaced', async () => {
      const other = await h.seedKitchen({ name: 'Second Kitchen' });
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, k.itemId, [k.regularId]);
      const mixed = await h.addToCart(c.token, other.itemId, [other.regularId]);
      expect(mixed.status).toBe(409);
      expect(mixed.body.error.code).toBe('CART_MIXED_KITCHENS');
      const replaced = await h.call('post', '/cart/items?replace=true', c.token, {
        menuItemId: other.itemId,
        quantity: 1,
        optionIds: [other.regularId],
      });
      expect(replaced.status).toBe(201);
      expect(replaced.body.data.kitchenId).toBe(other.kitchenId);
    });

    it('minimum order is enforced at checkout', async () => {
      const m = await h.seedKitchen({ name: 'Pricey', minOrderMinor: 50000 });
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, m.itemId, [m.regularId]);
      const q = await h.call('post', '/checkout/quote', c.token, {
        fulfillment: 'DELIVERY',
        addressId: c.addressId,
      });
      const res = await h.placeOrder(c, q.body.data.pricing.total, 'CARD');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('MIN_ORDER_NOT_MET');
    });

    it('stale price: expectedTotal mismatch -> PRICE_CHANGED with the real total, nothing created', async () => {
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, k.itemId, [k.regularId]);
      const res = await h.placeOrder(c, 100, 'CARD');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRICE_CHANGED');
      expect(res.body.error.details.actualTotal).toBe(5750);
      expect(await h.prisma.order.count({ where: { customerId: c.id } })).toBe(0);
      // cart is preserved so the customer can accept the new price
      expect((await h.call('get', '/cart', c.token)).body.data.lines).toHaveLength(1);
    });

    it('a price edit by the cook after carting is caught at checkout', async () => {
      const kk = await h.seedKitchen({ name: 'Repricer' });
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, kk.itemId, [kk.regularId]);
      const q = await h.call('post', '/checkout/quote', c.token, {
        fulfillment: 'DELIVERY',
        addressId: c.addressId,
      });
      await h.call('patch', `/cook/menu/${kk.itemId}`, kk.cook.token, { priceMinor: 6000 });
      const res = await h.placeOrder(c, q.body.data.pricing.total, 'CARD');
      expect(res.body.error.code).toBe('PRICE_CHANGED');
      const audit = await h.prisma.auditLog.findFirst({
        where: { action: 'PRICE_CHANGED', entityId: kk.itemId },
      });
      expect(audit).toBeTruthy();
    });

    it('unavailable item / closed kitchen block checkout', async () => {
      const kk = await h.seedKitchen({ name: 'Flaky' });
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, kk.itemId, [kk.regularId]);
      await h.call('patch', `/cook/menu/${kk.itemId}`, kk.cook.token, { isAvailable: false });
      let res = await h.placeOrder(c, 5750, 'CARD');
      expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
      await h.call('patch', `/cook/menu/${kk.itemId}`, kk.cook.token, { isAvailable: true });
      await h.call('patch', `/cook/kitchens/${kk.kitchenId}/availability`, kk.cook.token, {
        acceptingOrders: false,
      });
      res = await h.placeOrder(c, 5750, 'CARD');
      expect(res.body.error.code).toBe('KITCHEN_UNAVAILABLE');
      const listed = (await h.call('get', `/kitchens/${kk.kitchenId}`)).body.data;
      expect(listed.availability).toBe('TEMPORARILY_UNAVAILABLE');
    });
  });

  describe('idempotency', () => {
    it('same Idempotency-Key => same order, one row, even when sent concurrently', async () => {
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, k.itemId, [k.regularId]);
      const key = randomUUID();
      const rs = await Promise.all([1, 2, 3, 4, 5].map(() => h.placeOrder(c, 5750, 'CARD', key)));
      const ok = rs.filter((r) => r.status === 201 || r.status === 200);
      const ids = new Set(ok.map((r) => r.body.data.order.id));
      expect(ids.size).toBe(1);
      expect(await h.prisma.order.count({ where: { customerId: c.id } })).toBe(1);
      // later replay returns the same order without a second payment attempt
      const again = await h.placeOrder(c, 5750, 'CARD', key);
      expect(again.body.data.order.id).toBe([...ids][0]);
      expect(await h.prisma.payment.count({ where: { orderId: [...ids][0] } })).toBe(1);
    });

    it('same key with a different body is rejected', async () => {
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, k.itemId, [k.regularId]);
      const key = randomUUID();
      expect((await h.placeOrder(c, 5750, 'CARD', key)).status).toBe(201);
      const diff = await h.placeOrder(c, 5750, 'CASH_ON_DELIVERY', key);
      expect(diff.status).toBe(409);
      expect(diff.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('missing Idempotency-Key is refused', async () => {
      const c = await h.customerWithAddress();
      await h.addToCart(c.token, k.itemId, [k.regularId]);
      const res = await h.call('post', '/orders', c.token, {
        addressId: c.addressId,
        fulfillment: 'DELIVERY',
        paymentMethod: 'CARD',
        expectedTotal: 5750,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('stock cannot be oversold under concurrency', () => {
    it('stock=2, five customers race: exactly two orders succeed, stock ends at 0', async () => {
      const s = await h.seedKitchen({ name: 'Limited', stock: 2 });
      const customers = await Promise.all([1, 2, 3, 4, 5].map(() => h.customerWithAddress()));
      for (const c of customers) await h.addToCart(c.token, s.itemId, [s.regularId]);
      const rs = await Promise.all(customers.map((c) => h.placeOrder(c, 5750, 'CASH_ON_DELIVERY')));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
      expect(
        rs.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'ITEM_UNAVAILABLE'),
      ).toBe(true);
      expect((await h.prisma.menuItem.findUniqueOrThrow({ where: { id: s.itemId } })).stock).toBe(
        0,
      );
    });

    it('cancelling an order returns its stock', async () => {
      const s = await h.seedKitchen({ name: 'Restock', stock: 1 });
      const c = await h.customerWithAddress();
      const { order } = await h.checkout(c, s, 'CASH_ON_DELIVERY');
      expect((await h.prisma.menuItem.findUniqueOrThrow({ where: { id: s.itemId } })).stock).toBe(
        0,
      );
      expect((await h.call('post', `/orders/${order.id}/cancel`, c.token, {})).status).toBe(201);
      expect((await h.prisma.menuItem.findUniqueOrThrow({ where: { id: s.itemId } })).stock).toBe(
        1,
      );
    });
  });

  describe('card payments via signed webhooks', () => {
    it('order stays PENDING_PAYMENT until a verified webhook arrives; duplicate callbacks are no-ops', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(payment.providerRef).toMatch(/^sbx_/);

      // Client-side "success" means nothing: the cook cannot even see the order yet.
      expect(
        (
          await h.call('get', `/cook/kitchens/${k.kitchenId}/orders?scope=pending`, k.cook.token)
        ).body.data.items.find((o: any) => o.id === order.id),
      ).toBeUndefined();

      const evt = {
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        providerRef: payment.providerRef,
        amountMinor: order.totalMinor,
      };
      expect((await h.webhook(evt)).body.data.duplicate).toBe(false);
      expect((await orderRow(order.id)).status).toBe('PLACED');
      const dup = await h.webhook(evt);
      expect(dup.status).toBe(200);
      expect(dup.body.data.duplicate).toBe(true);
      // ... and the same callback delivered concurrently several times still settles once
      const evt2 = { ...evt, id: `evt_${randomUUID()}` };
      await Promise.all([1, 2, 3].map(() => h.webhook(evt2)));
      expect(
        await h.prisma.ledgerEntry.count({
          where: { orderId: order.id, account: 'CUSTOMER_PAYMENT' },
        }),
      ).toBe(1);
      expect(
        await h.prisma.orderStatusHistory.count({
          where: { orderId: order.id, toStatus: 'PLACED' },
        }),
      ).toBe(1);
      // the kitchen was notified exactly once
      expect(
        await h.prisma.notification.count({
          where: { userId: k.cook.id, data: { path: ['orderId'], equals: order.id } },
        }),
      ).toBe(1);
    });

    it('rejects forged/unsigned webhooks and records them', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      const evt = {
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        providerRef: payment.providerRef,
        amountMinor: order.totalMinor,
      };
      const bad = await h.webhook(evt, 'deadbeef');
      expect(bad.status).toBe(401);
      expect((await orderRow(order.id)).status).toBe('PENDING_PAYMENT');
      expect(
        await h.prisma.webhookEvent.count({ where: { signatureValid: false } }),
      ).toBeGreaterThan(0);
    });

    it('amount mismatch never places the order', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.webhook({
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        providerRef: payment.providerRef,
        amountMinor: 1,
      });
      expect((await orderRow(order.id)).status).toBe('PENDING_PAYMENT');
      expect(
        (await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).failureReason,
      ).toBe('amount_mismatch');
    });

    it('failed payment -> retry works with a fresh attempt; old attempt is cancelled', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      expect(
        (
          await h.call('post', `/payments/sandbox/${payment.providerRef}/complete`, c.token, {
            outcome: 'fail',
          })
        ).status,
      ).toBe(200);
      expect(
        (await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status,
      ).toBe('FAILED');
      expect((await orderRow(order.id)).status).toBe('PENDING_PAYMENT');

      const retry = await h.call('post', `/orders/${order.id}/pay`, c.token);
      expect(retry.status).toBe(201);
      const p2 = retry.body.data.payment;
      expect(p2.providerRef).not.toBe(payment.providerRef);
      // user taps pay again immediately (double tap / app reopened): same live attempt
      const retry2 = await h.call('post', `/orders/${order.id}/pay`, c.token);
      expect(retry2.body.data.payment.providerRef).toBe(p2.providerRef);
      expect((await h.payOrder(c.token, p2.providerRef)).status).toBe(200);
      expect((await orderRow(order.id)).status).toBe('PLACED');
    });

    it('payment succeeding after the order expired is automatically refunded', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.prisma.order.update({
        where: { id: order.id },
        data: { createdAt: new Date(Date.now() - 3_600_000) },
      });
      const r = await h.jobs.runOnce();
      expect(r.expired).toBeGreaterThanOrEqual(1);
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      // app closed mid-payment; gateway settles late
      await h.webhook({
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        providerRef: payment.providerRef,
        amountMinor: order.totalMinor,
      });
      expect((await orderRow(order.id)).status).toBe('REFUNDED');
      const refund = await h.prisma.refund.findFirstOrThrow({ where: { orderId: order.id } });
      expect(refund).toMatchObject({ status: 'SUCCEEDED', amountMinor: order.totalMinor });
      const net = await h.prisma.ledgerEntry.aggregate({
        where: { orderId: order.id },
        _sum: { amountMinor: true },
      });
      expect(net._sum.amountMinor).toBe(0); // money in == money out
    });

    it('a paid-but-unplaced order (crash between commit and transition) is recovered by the reconciler', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.prisma.payment.update({
        where: { id: payment.paymentId },
        data: { status: 'SUCCEEDED' },
      });
      await h.jobs.runOnce();
      expect((await orderRow(order.id)).status).toBe('PLACED');
    });
  });

  describe('order lifecycle (happy path, COD and card) + ledger', () => {
    it('card order: full lifecycle, immutable history, ledger reconciles to the cent', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.payOrder(c.token, payment.providerRef);

      const tr = (to: string, token = k.cook.token, reason?: string) =>
        h.call('post', `/cook/orders/${order.id}/transition`, token, { to, reason });
      // illegal jumps are rejected by the state machine
      expect((await tr('DELIVERED')).status).toBe(409);
      expect((await tr('READY')).status).toBe(409);
      for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
        const r = await tr(to);
        expect(r.status).toBe(200);
        expect(r.body.data.status).toBe(to);
      }
      expect((await tr('ACCEPTED')).status).toBe(409); // no going back
      // customer sees timeline & got a notification per step
      const mine = await h.call('get', `/orders/${order.id}`, c.token);
      expect(mine.body.data.history.map((x: any) => x.to)).toEqual([
        'PENDING_PAYMENT',
        'PLACED',
        'ACCEPTED',
        'PREPARING',
        'READY',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
      ]);
      expect(
        (await h.call('get', '/notifications', c.token)).body.data.items.length,
      ).toBeGreaterThanOrEqual(6);

      // customer confirms receipt -> COMPLETED -> revenue recognised
      expect(
        (await h.call('post', `/orders/${order.id}/confirm-received`, c.token)).body.data.status,
      ).toBe('COMPLETED');
      const entries = await h.prisma.ledgerEntry.findMany({ where: { orderId: order.id } });
      const by = (a: string) =>
        entries.filter((e) => e.account === a).reduce((s, e) => s + e.amountMinor, 0);
      expect(by('CUSTOMER_PAYMENT')).toBe(order.totalMinor);
      expect(by('VENDOR_EARNINGS') + by('PLATFORM_FEE') + by('TAX')).toBe(order.totalMinor);
      expect(by('VENDOR_EARNINGS')).toBe(4000 - 600 + 1000); // subtotal - 15% commission + delivery
      expect(by('TAX')).toBe(order.taxMinor);
      const bal = (await h.call('get', `/cook/kitchens/${k.kitchenId}/earnings`, k.cook.token)).body
        .data.balance;
      expect(bal.availableMinor).toBeGreaterThanOrEqual(4400);
    });

    it('COD order: kitchen holds the cash, so ledger nets what the kitchen owes the platform', async () => {
      const kk = await h.seedKitchen({ name: 'Cash Kitchen' });
      const c = await h.customerWithAddress();
      const { order } = await h.checkout(c, kk, 'CASH_ON_DELIVERY');
      expect(order.status).toBe('PLACED'); // no gateway needed
      const tr = (to: string) =>
        h.call('post', `/cook/orders/${order.id}/transition`, kk.cook.token, { to });
      for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'])
        expect((await tr(to)).status).toBe(200);
      expect(
        (await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status,
      ).toBe('SUCCEEDED');
      await h.call('post', `/orders/${order.id}/confirm-received`, c.token);
      const bal = await h.prisma.ledgerEntry.aggregate({
        where: { kitchenId: kk.kitchenId, account: 'VENDOR_EARNINGS' },
        _sum: { amountMinor: true },
      });
      expect(bal._sum.amountMinor).toBe(4400 - order.totalMinor); // earnings minus cash already collected (negative = owes platform)
      // cash orders have nothing to refund online
      const admin = await h.createStaff(['ADMIN']);
      const rf = await h.call(
        'post',
        `/admin/orders/${order.id}/refund`,
        admin.token,
        { reason: 'test' },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(rf.status).toBe(409);
    });

    it('kitchen rejecting a paid order refunds the customer automatically', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.payOrder(c.token, payment.providerRef);
      const noReason = await h.call('post', `/cook/orders/${order.id}/transition`, k.cook.token, {
        to: 'REJECTED',
      });
      expect(noReason.status).toBe(400);
      expect(
        (
          await h.call('post', `/cook/orders/${order.id}/transition`, k.cook.token, {
            to: 'REJECTED',
            reason: 'Out of rice',
          })
        ).status,
      ).toBe(200);
      const o = await orderRow(order.id);
      expect(o.status).toBe('REFUNDED');
      expect(o.cancelReason).toBe('Out of rice');
      expect(
        (await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status,
      ).toBe('REFUNDED');
    });

    it('customer can cancel only before the kitchen accepts', async () => {
      const c = await h.customerWithAddress();
      const a = await h.checkout(c, k, 'CASH_ON_DELIVERY');
      expect(
        (await h.call('post', `/orders/${a.order.id}/cancel`, c.token, { reason: 'changed mind' }))
          .status,
      ).toBe(201);
      const b = await h.checkout(c, k, 'CASH_ON_DELIVERY');
      await h.call('post', `/cook/orders/${b.order.id}/transition`, k.cook.token, {
        to: 'ACCEPTED',
      });
      const late = await h.call('post', `/orders/${b.order.id}/cancel`, c.token, {});
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('ILLEGAL_TRANSITION');
    });

    it('cook cancelling an accepted paid order refunds in full', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.payOrder(c.token, payment.providerRef);
      await h.call('post', `/cook/orders/${order.id}/transition`, k.cook.token, { to: 'ACCEPTED' });
      await h.call('post', `/cook/orders/${order.id}/transition`, k.cook.token, {
        to: 'CANCELLED',
        reason: 'Gas ran out',
      });
      expect((await orderRow(order.id)).status).toBe('REFUNDED');
    });

    it('kitchen that never responds: job rejects and refunds', async () => {
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, k, 'CARD');
      await h.payOrder(c.token, payment.providerRef);
      await h.prisma.order.update({
        where: { id: order.id },
        data: { placedAt: new Date(Date.now() - 3_600_000) },
      });
      const r = await h.jobs.runOnce();
      expect(r.rejected).toBeGreaterThanOrEqual(1);
      expect((await orderRow(order.id)).status).toBe('REFUNDED');
    });

    it('delivered orders auto-complete after the confirmation window', async () => {
      const kk = await h.seedKitchen({ name: 'Auto Complete' });
      const c = await h.customerWithAddress();
      const { order } = await h.checkout(c, kk, 'CASH_ON_DELIVERY');
      for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'])
        await h.call('post', `/cook/orders/${order.id}/transition`, kk.cook.token, { to });
      await h.prisma.order.update({
        where: { id: order.id },
        data: { deliveredAt: new Date(Date.now() - 48 * 3_600_000) },
      });
      await h.jobs.runOnce();
      expect((await orderRow(order.id)).status).toBe('COMPLETED');
    });
  });

  describe('refunds', () => {
    it('admin refund is idempotent, cannot exceed the amount paid, and partial refunds are supported', async () => {
      const kk = await h.seedKitchen({ name: 'Refund Kitchen' });
      const c = await h.customerWithAddress();
      const { order, payment } = await h.checkout(c, kk, 'CARD');
      await h.payOrder(c.token, payment.providerRef);
      for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'])
        await h.call('post', `/cook/orders/${order.id}/transition`, kk.cook.token, { to });
      await h.call('post', `/orders/${order.id}/confirm-received`, c.token);

      const admin = await h.createStaff(['ADMIN']);
      const key = randomUUID();
      const partial = { amountMinor: 1000, reason: 'Cold food' };
      const [a, b] = await Promise.all([
        h.call('post', `/admin/orders/${order.id}/refund`, admin.token, partial, {
          'Idempotency-Key': key,
        }),
        h.call('post', `/admin/orders/${order.id}/refund`, admin.token, partial, {
          'Idempotency-Key': key,
        }),
      ]);
      expect(a.status).toBe(200);
      expect(b.body.data.id).toBe(a.body.data.id);
      expect(await h.prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
      expect((await orderRow(order.id)).status).toBe('COMPLETED'); // partial: order stays completed
      expect(
        (await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status,
      ).toBe('PARTIALLY_REFUNDED');

      const over = await h.call(
        'post',
        `/admin/orders/${order.id}/refund`,
        admin.token,
        { amountMinor: order.totalMinor, reason: 'too much' },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(over.status).toBe(409);
      // remaining balance in full -> REFUNDED
      const rest = await h.call(
        'post',
        `/admin/orders/${order.id}/refund`,
        admin.token,
        { reason: 'Goodwill' },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(rest.status).toBe(200);
      expect((await orderRow(order.id)).status).toBe('REFUNDED');
      const net = await h.prisma.ledgerEntry.groupBy({
        by: ['account'],
        where: { orderId: order.id },
        _sum: { amountMinor: true },
      });
      const m = Object.fromEntries(net.map((n) => [n.account, n._sum.amountMinor]));
      expect(m['CUSTOMER_PAYMENT']! + m['REFUND']!).toBe(0);
      // a fully refunded order leaves no revenue behind, including the earlier partial adjustment
      for (const acct of ['VENDOR_EARNINGS', 'PLATFORM_FEE', 'TAX', 'ADJUSTMENT'])
        expect(m[acct] ?? 0).toBe(0);
      expect(
        await h.prisma.auditLog.count({ where: { action: 'REFUND_ISSUED', entityId: order.id } }),
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('database-level integrity (defence in depth)', () => {
    it('audit log, status history and ledger are append-only even for raw SQL', async () => {
      await expect(h.prisma.$executeRaw`UPDATE "AuditLog" SET action = 'tampered'`).rejects.toThrow(
        /append-only/,
      );
      await expect(h.prisma.$executeRaw`DELETE FROM "OrderStatusHistory"`).rejects.toThrow(
        /append-only/,
      );
      await expect(h.prisma.$executeRaw`DELETE FROM "LedgerEntry"`).rejects.toThrow(/append-only/);
      await expect(h.prisma.$executeRawUnsafe(`TRUNCATE "AuditLog" CASCADE`)).rejects.toThrow(
        /append-only/,
      );
    });
    it('illegal order status jumps are rejected by the database itself', async () => {
      const c = await h.customerWithAddress();
      const { order } = await h.checkout(c, k, 'CARD');
      await expect(
        h.prisma.$executeRaw`UPDATE "Order" SET status = 'COMPLETED' WHERE id = ${order.id}::uuid`,
      ).rejects.toThrow(/illegal order transition/);
    });
    it('two successful payments for one order cannot exist', async () => {
      const c = await h.customerWithAddress();
      const { order } = await h.checkout(c, k, 'CARD');
      const p = await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      await h.prisma.payment.update({ where: { id: p.id }, data: { status: 'SUCCEEDED' } });
      await expect(
        h.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: 'sandbox',
            method: 'CARD',
            status: 'SUCCEEDED',
            amountMinor: order.totalMinor,
            currency: 'SAR',
            idempotencyKey: `dup-${randomUUID()}`,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
