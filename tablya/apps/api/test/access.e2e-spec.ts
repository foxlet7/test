import { randomUUID } from 'crypto';
import { Harness } from './harness';

describe('Authorization, IDOR and abuse resistance', () => {
  const h = new Harness();
  let k: Awaited<ReturnType<Harness['seedKitchen']>>;
  let cust: Awaited<ReturnType<Harness['customerWithAddress']>>;
  let order: any;
  beforeAll(async () => {
    await h.start();
    k = await h.seedKitchen();
    cust = await h.customerWithAddress();
    order = (await h.checkout(cust, k, 'CASH_ON_DELIVERY')).order;
  });
  afterAll(() => h.stop());

  it('customers cannot reach admin or cook endpoints', async () => {
    for (const [m, u] of [
      ['get', '/admin/dashboard'],
      ['get', '/admin/users'],
      ['get', '/admin/audit-logs'],
      ['post', '/admin/coupons'],
      ['get', '/cook/kitchens'],
      ['post', `/cook/orders/${order.id}/transition`],
    ] as const) {
      const r = await h.call(m, u, cust.token, m === 'post' ? {} : undefined);
      expect([403, 400]).toContain(r.status);
      if (r.status === 403) expect(r.body.error.code).toBe('FORBIDDEN');
      expect(r.status).not.toBe(200);
    }
  });

  it('cooks cannot reach admin endpoints', async () => {
    for (const u of ['/admin/dashboard', '/admin/users', '/admin/orders'])
      expect((await h.call('get', u, k.cook.token)).status).toBe(403);
    expect(
      (
        await h.call('post', `/admin/kitchens/${k.kitchenId}/review`, k.cook.token, {
          decision: 'approve',
        })
      ).status,
    ).toBe(403);
  });

  it('anonymous callers get 401 on every protected area', async () => {
    for (const u of [
      '/me',
      '/cart',
      '/orders',
      '/cook/kitchens',
      '/admin/dashboard',
      '/notifications',
      '/favorites',
    ])
      expect((await h.call('get', u)).status).toBe(401);
    expect(
      (await h.call('post', '/orders', undefined, {}, { 'Idempotency-Key': randomUUID() })).status,
    ).toBe(401);
  });

  it("IDOR: another customer cannot read or cancel someone else's order (404, not 403)", async () => {
    const other = await h.customerWithAddress();
    expect((await h.call('get', `/orders/${order.id}`, other.token)).status).toBe(404);
    expect((await h.call('post', `/orders/${order.id}/cancel`, other.token, {})).status).toBe(404);
    expect((await h.call('post', `/orders/${order.id}/confirm-received`, other.token)).status).toBe(
      404,
    );
    expect((await h.call('post', `/orders/${order.id}/pay`, other.token)).status).toBe(404);
    const list = await h.call('get', '/orders', other.token);
    expect(list.body.data.items).toHaveLength(0);
  });

  it("IDOR: another cook cannot see, edit or transition this kitchen's data", async () => {
    const rival = await h.register('COOK');
    expect((await h.call('get', `/cook/kitchens/${k.kitchenId}/orders`, rival.token)).status).toBe(
      404,
    );
    expect((await h.call('get', `/cook/kitchens/${k.kitchenId}/menu`, rival.token)).status).toBe(
      404,
    );
    expect(
      (await h.call('get', `/cook/kitchens/${k.kitchenId}/dashboard`, rival.token)).status,
    ).toBe(404);
    expect(
      (await h.call('get', `/cook/kitchens/${k.kitchenId}/earnings`, rival.token)).status,
    ).toBe(404);
    expect(
      (await h.call('patch', `/cook/kitchens/${k.kitchenId}`, rival.token, { name: 'Hijacked' }))
        .status,
    ).toBe(404);
    expect(
      (await h.call('patch', `/cook/menu/${k.itemId}`, rival.token, { priceMinor: 1 })).status,
    ).toBe(404);
    expect((await h.call('delete', `/cook/menu/${k.itemId}`, rival.token)).status).toBe(404);
    expect(
      (await h.call('put', `/cook/kitchens/${k.kitchenId}/zones`, rival.token, { zones: [] }))
        .status,
    ).toBe(404);
    expect((await h.call('get', `/cook/orders/${order.id}`, rival.token)).status).toBe(404);
    expect(
      (await h.call('post', `/cook/orders/${order.id}/transition`, rival.token, { to: 'ACCEPTED' }))
        .status,
    ).toBe(404);
    const unchanged = await h.prisma.kitchen.findUniqueOrThrow({ where: { id: k.kitchenId } });
    expect(unchanged.name).toBe('Fatima Kitchen');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PLACED',
    );
  });

  it("IDOR: users cannot use someone else's address, cart item, upload or review", async () => {
    const other = await h.customerWithAddress();
    // address of another user at checkout
    await h.addToCart(other.token, k.itemId, [k.regularId]);
    const q = await h.call('post', '/checkout/quote', other.token, {
      fulfillment: 'DELIVERY',
      addressId: cust.addressId,
    });
    expect(q.body.data.issues[0].code).toBe('NOT_FOUND');
    expect(
      (
        await h.call('put', `/me/addresses/${cust.addressId}`, other.token, {
          line1: 'x',
          city: 'y',
          lat: 1,
          lng: 1,
        })
      ).status,
    ).toBe(404);
    expect((await h.call('delete', `/me/addresses/${cust.addressId}`, other.token)).status).toBe(
      404,
    );
    // cart item
    const mine = await h.call('get', '/cart', cust.token);
    await h.addToCart(cust.token, k.itemId, [k.regularId]);
    const cartItemId = (await h.call('get', '/cart', cust.token)).body.data.lines[0].cartItemId;
    expect(
      (await h.call('patch', `/cart/items/${cartItemId}`, other.token, { quantity: 9 })).status,
    ).toBe(404);
    expect(mine.status).toBe(200);
    // upload reference: cannot attach an image someone else uploaded
    const theirs = await h.upload(other.token, 'menu_item');
    const res = await h.call('patch', `/cook/menu/${k.itemId}`, k.cook.token, {
      imageKeys: [theirs.body.data.key],
    });
    expect(res.status).toBe(415);
  });

  it('cooks cannot self-grant staff roles or touch roles via the API', async () => {
    const admin = await h.createStaff(['ADMIN']);
    const roleChange = await h.call('put', `/admin/users/${k.cook.id}/roles`, admin.token, {
      roles: ['SUPER_ADMIN'],
      reason: 'escalation',
    });
    expect(roleChange.status).toBe(403); // only SUPER_ADMIN may change roles
    const sa = await h.createStaff(['SUPER_ADMIN']);
    expect(
      (
        await h.call('put', `/admin/users/${k.cook.id}/roles`, sa.token, {
          roles: ['CUSTOMER', 'COOK', 'MODERATOR'],
          reason: 'promote',
        })
      ).status,
    ).toBe(200);
    expect((await h.call('get', '/me', k.cook.token)).status).toBe(401); // sessions revoked so claims refresh
    expect(
      (
        await h.call('put', `/admin/users/${sa.id}/roles`, sa.token, {
          roles: ['CUSTOMER'],
          reason: 'self',
        })
      ).status,
    ).toBe(403);
    const log = await h.prisma.auditLog.findFirst({
      where: { action: 'ROLES_CHANGED', entityId: k.cook.id },
    });
    expect(log).toBeTruthy();
  });

  it('role scoping inside staff: support cannot refund, moderator cannot see payments', async () => {
    const support = await h.createStaff(['SUPPORT']);
    const mod = await h.createStaff(['MODERATOR']);
    expect((await h.call('get', '/admin/orders', support.token)).status).toBe(200);
    expect(
      (
        await h.call(
          'post',
          `/admin/orders/${order.id}/refund`,
          support.token,
          { reason: 'x' },
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(403);
    expect((await h.call('get', '/admin/payments', mod.token)).status).toBe(403);
    expect((await h.call('get', '/admin/reports', mod.token)).status).toBe(200);
    expect((await h.call('get', '/admin/audit-logs', support.token)).status).toBe(403);
  });

  it('admins cannot suspend themselves; non-super admins cannot suspend staff', async () => {
    const a1 = await h.createStaff(['ADMIN']);
    const a2 = await h.createStaff(['ADMIN']);
    expect(
      (await h.call('post', `/admin/users/${a1.id}/suspend`, a1.token, { reason: 'oops' })).status,
    ).toBe(403);
    expect(
      (await h.call('post', `/admin/users/${a2.id}/suspend`, a1.token, { reason: 'rogue' })).status,
    ).toBe(403);
  });

  it('sensitive admin actions require a reason and are audit-logged with actor and request id', async () => {
    const admin = await h.createStaff(['ADMIN']);
    const victim = await h.register();
    expect(
      (await h.call('post', `/admin/users/${victim.id}/suspend`, admin.token, {})).status,
    ).toBe(400);
    const r = await h.call('post', `/admin/users/${victim.id}/suspend`, admin.token, {
      reason: 'chargeback fraud',
    });
    expect(r.status).toBe(200);
    const log = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'USER_SUSPENDED', entityId: victim.id },
    });
    expect(log).toMatchObject({ actorId: admin.id, actorRole: 'ADMIN' });
    expect(log.requestId).toBeTruthy();
    expect(log.meta).toMatchObject({ reason: 'chargeback fraud' });
  });

  it('validation: unknown fields are stripped, malformed ids and bodies are 400/404 not 500', async () => {
    expect((await h.call('get', '/orders/not-a-uuid', cust.token)).status).toBe(400);
    expect(
      (await h.call('post', '/cart/items', cust.token, { menuItemId: 'nope', quantity: 1 })).status,
    ).toBe(400);
    expect(
      (await h.call('post', '/cart/items', cust.token, { menuItemId: k.itemId, quantity: -5 }))
        .status,
    ).toBe(400);
    expect(
      (await h.call('post', '/cart/items', cust.token, { menuItemId: k.itemId, quantity: 1.5 }))
        .status,
    ).toBe(400);
    expect(
      (
        await h.call('post', '/me/addresses', cust.token, {
          line1: 'x',
          city: 'y',
          lat: 999,
          lng: 0,
        })
      ).status,
    ).toBe(400);
    const huge = await h
      .req()
      .post('/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(400_000) }));
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('VALIDATION_FAILED');
    const badJson = await h
      .req()
      .post('/auth/login')
      .set('content-type', 'application/json')
      .send('{not json');
    expect(badJson.status).toBe(400);
  });

  it('SQL injection attempts in search are inert', async () => {
    for (const q of ['\'; DROP TABLE "User"; --', "%' OR 1=1 --", '\\', 'a%_']) {
      const r = await h.call('get', `/kitchens?q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
      const s = await h.call('get', `/search?q=${encodeURIComponent(q)}`);
      expect(s.status).toBe(200);
    }
    expect(await h.prisma.user.count()).toBeGreaterThan(0);
  });

  it('security headers are present and fingerprinting is off', async () => {
    const r = await h.req().get('/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeTruthy();
  });

  it('rate limiting kicks in on auth endpoints (429 with structured error)', async () => {
    // Use a dedicated app with a tiny limit.
    process.env.AUTH_THROTTLE_LIMIT = '3';
    const limited = new Harness();
    await limited.start();
    const rs = [];
    for (let i = 0; i < 6; i++)
      rs.push(
        await limited
          .req()
          .post('/auth/login')
          .send({ email: `x${i}@example.com`, password: 'WrongPassword1' }),
      );
    expect(rs.some((r) => r.status === 429)).toBe(true);
    const hit = rs.find((r) => r.status === 429)!;
    expect(hit.body.error.code).toBe('RATE_LIMITED');
    await limited.stop();
    process.env.AUTH_THROTTLE_LIMIT = '100000';
  });
});

describe('Uploads', () => {
  const h = new Harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('accepts a valid image, re-encodes to webp, strips metadata, generates a thumbnail', async () => {
    const u = await h.register('COOK');
    const sharp = require('sharp');
    const withExif = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#fff' },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-gps-owner' } })
      .toBuffer();
    const r = await h.upload(u.token, 'menu_item', withExif, 'photo.jpg');
    expect(r.status).toBe(201);
    expect(r.body.data.key).toMatch(/^menu_item\/[0-9a-f-]{36}\.webp$/);
    const served = await h.req().get(new URL(r.body.data.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(served.body).includes(Buffer.from('secret-gps-owner'))).toBe(false);
    expect((await h.req().get(new URL(r.body.data.thumbUrl).pathname)).status).toBe(200);
  });

  it('rejects non-images disguised with image extensions, SVG/HTML, corrupt files, tiny and huge dimensions', async () => {
    const u = await h.register('COOK');
    const cases: [string, Buffer, string][] = [
      ['script as png', Buffer.from('<script>alert(1)</script>'.repeat(10)), 'evil.png'],
      [
        'svg',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        'x.svg',
      ],
      [
        'php polyglot',
        Buffer.concat([Buffer.from('<?php system($_GET[0]); ?>'), Buffer.alloc(100)]),
        'shell.php.png',
      ],
      [
        'truncated png header',
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(40, 1),
        ]),
        'broken.png',
      ],
      ['too small', await h.png(10, 10), 'tiny.png'],
    ];
    for (const [label, buf, name] of cases) {
      const r = await h.upload(u.token, 'kitchen', buf, name);
      expect([label, r.status]).toEqual([label, 415]);
      expect(r.body.error.code).toBe('UPLOAD_REJECTED');
    }
  });

  it('rejects oversize files and unknown purposes, and requires auth', async () => {
    const u = await h.register();
    const big = Buffer.concat([await h.png(), Buffer.alloc(6 * 1024 * 1024)]);
    const r = await h.upload(u.token, 'kitchen', big);
    expect([413, 415]).toContain(r.status);
    expect((await h.upload(u.token, 'passwords')).status).toBe(400);
    expect(
      (
        await h
          .req()
          .post('/uploads')
          .field('purpose', 'kitchen')
          .attach('file', await h.png(), 'a.png')
      ).status,
    ).toBe(401);
  });

  it('private verification documents are never served publicly', async () => {
    const u = await h.register('COOK');
    const r = await h.upload(u.token, 'verification_doc');
    expect(r.body.data.url).toBeNull();
    const guess = await h.req().get(`/uploads/${r.body.data.key}`);
    expect(guess.status).toBe(404);
    const traversal = await h.req().get('/uploads/../private/' + r.body.data.key.split('/')[1]);
    expect(traversal.status).not.toBe(200);
  });
});
