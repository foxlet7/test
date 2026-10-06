import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac, randomUUID } from 'crypto';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { JobsService } from '../src/modules/health/jobs.service';
import { newTotpSecret, totpAt } from '../src/common/crypto';

export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const uniq = () => randomUUID().slice(0, 8);

export class Harness {
  app!: INestApplication;
  prisma = new PrismaClient();
  jobs!: JobsService;

  async start() {
    this.app = await createApp();
    await this.app.init();
    this.jobs = this.app.get(JobsService);
  }
  async stop() {
    await this.app.close();
    await this.prisma.$disconnect();
  }

  req() {
    return request(this.app.getHttpServer());
  }

  call(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    token?: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    let r = this.req()[method](url);
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body === undefined ? r : r.send(body as object);
  }

  async register(role: 'CUSTOMER' | 'COOK' = 'CUSTOMER', name = 'Test User') {
    const email = `u-${uniq()}@example.com`;
    const password = 'CorrectHorse9';
    const res = await this.req().post('/auth/register').send({ email, password, name, role });
    if (res.status !== 201)
      throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
    return {
      email,
      password,
      id: res.body.data.user.id as string,
      token: res.body.data.tokens.accessToken as string,
      refresh: res.body.data.tokens.refreshToken as string,
    };
  }

  /** Staff are created directly in the DB (there is deliberately no public path to staff roles). */
  async createStaff(roles: ('ADMIN' | 'SUPER_ADMIN' | 'SUPPORT' | 'MODERATOR')[]) {
    const email = `staff-${uniq()}@example.com`;
    const password = 'StaffPassw0rd!';
    const u = await this.prisma.user.create({
      data: {
        email,
        name: 'Staff',
        roles,
        passwordHash: await argon2.hash(password),
        status: 'ACTIVE',
      },
    });
    const res = await this.req().post('/auth/login').send({ email, password });
    return { id: u.id, email, password, token: res.body.data.tokens.accessToken as string };
  }

  async png(w = 400, h = 400) {
    return sharp({
      create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } },
    })
      .png()
      .toBuffer();
  }

  async upload(token: string, purpose: string, buf?: Buffer, filename = 'x.png') {
    return this.req()
      .post('/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('purpose', purpose)
      .attach('file', buf ?? (await this.png()), filename);
  }

  sign(event: object) {
    const body = JSON.stringify(event);
    return { body, signature: createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex') };
  }

  webhook(event: object, signature?: string) {
    const s = this.sign(event);
    return this.req()
      .post('/payments/webhooks/sandbox')
      .set('content-type', 'application/json')
      .set('x-tablya-signature', signature ?? s.signature)
      .send(s.body);
  }

  /** A fully verified kitchen with one item (with an option group), open 24/7, delivering within 10 km. */
  async seedKitchen(
    opts: { stock?: number | null; minOrderMinor?: number; name?: string; nameAr?: string } = {},
  ) {
    const cook = await this.register('COOK', 'Cook Fatima');
    const admin = await this.createStaff(['ADMIN']);
    const cuisine = await this.prisma.cuisine.create({
      data: { slug: `c-${uniq()}`, name: 'Saudi', nameAr: 'سعودي' },
    });
    const category = await this.prisma.category.create({
      data: { slug: `cat-${uniq()}`, name: 'Mains', nameAr: 'أطباق رئيسية' },
    });
    const cover = await this.upload(cook.token, 'kitchen');
    const doc = await this.upload(cook.token, 'verification_doc');
    const k = await this.call('post', '/cook/kitchens', cook.token, {
      name: opts.name ?? 'Fatima Kitchen',
      nameAr: opts.nameAr ?? 'مطبخ فاطمة',
      description: 'Home cooked kabsa',
      city: 'Riyadh',
      lat: 24.7136,
      lng: 46.6753,
      minOrderMinor: opts.minOrderMinor ?? 0,
      cuisineIds: [cuisine.id],
      coverKey: cover.body.data.key,
    });
    if (k.status !== 201) throw new Error(`kitchen create failed: ${JSON.stringify(k.body)}`);
    const kitchenId = k.body.data.id as string;
    const slots = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      openMinute: 0,
      closeMinute: 1439,
    }));
    await this.call('put', `/cook/kitchens/${kitchenId}/schedule`, cook.token, { slots });
    await this.call('put', `/cook/kitchens/${kitchenId}/zones`, cook.token, {
      zones: [
        { name: 'Near', maxKm: 5, feeMinor: 1000, etaMinutes: 20 },
        { name: 'Far', maxKm: 15, feeMinor: 2500, etaMinutes: 40 },
      ],
    });
    const item = await this.call('post', `/cook/kitchens/${kitchenId}/menu`, cook.token, {
      name: 'Chicken Kabsa',
      nameAr: 'كبسة دجاج',
      description: 'Spiced rice with chicken',
      priceMinor: 4000,
      categoryId: category.id,
      ingredients: ['rice', 'chicken'],
      allergens: [],
      stock: opts.stock === undefined ? null : opts.stock,
      optionGroups: [
        {
          name: 'Size',
          type: 'VARIATION',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [
            { name: 'Regular', priceDeltaMinor: 0 },
            { name: 'Large', priceDeltaMinor: 1000 },
          ],
        },
        { name: 'Extras', type: 'ADDON', options: [{ name: 'Salad', priceDeltaMinor: 500 }] },
      ],
    });
    if (item.status !== 201) throw new Error(`item create failed: ${JSON.stringify(item.body)}`);
    await this.call('post', `/cook/kitchens/${kitchenId}/documents`, cook.token, {
      type: 'NATIONAL_ID',
      key: doc.body.data.key,
    });
    const sub = await this.call('post', `/cook/kitchens/${kitchenId}/submit`, cook.token);
    if (sub.status !== 200) throw new Error(`submit failed: ${JSON.stringify(sub.body)}`);
    await this.call('post', `/admin/kitchens/${kitchenId}/review`, admin.token, {
      decision: 'start_review',
    });
    const ok = await this.call('post', `/admin/kitchens/${kitchenId}/review`, admin.token, {
      decision: 'approve',
    });
    if (ok.status !== 200) throw new Error(`approve failed: ${JSON.stringify(ok.body)}`);
    const full = (await this.call('get', `/kitchens/${kitchenId}`)).body.data;
    const m = full.menu[0];
    const size = m.optionGroups.find((g: any) => g.name === 'Size');
    const extras = m.optionGroups.find((g: any) => g.name === 'Extras');
    return {
      cook,
      admin,
      kitchenId,
      itemId: m.id as string,
      regularId: size.options[0].id as string,
      largeId: size.options[1].id as string,
      saladId: extras.options[0].id as string,
      cuisine,
      category,
    };
  }

  async customerWithAddress(lat = 24.72, lng = 46.68) {
    const c = await this.register('CUSTOMER', 'Ali Customer');
    const a = await this.call('post', '/me/addresses', c.token, {
      line1: '12 Palm St',
      city: 'Riyadh',
      lat,
      lng,
    });
    return { ...c, addressId: a.body.data.id as string };
  }

  async addToCart(token: string, itemId: string, optionIds: string[], quantity = 1) {
    return this.call('post', '/cart/items', token, { menuItemId: itemId, quantity, optionIds });
  }

  async placeOrder(
    c: { token: string; addressId: string },
    expectedTotal: number,
    method: 'CARD' | 'CASH_ON_DELIVERY',
    key = randomUUID(),
    extra: object = {},
  ) {
    return this.call(
      'post',
      '/orders',
      c.token,
      {
        addressId: c.addressId,
        fulfillment: 'DELIVERY',
        paymentMethod: method,
        expectedTotal,
        ...extra,
      },
      { 'Idempotency-Key': key },
    );
  }

  /** Convenience: cart -> quote -> order. Returns order JSON and total. */
  async checkout(
    c: { token: string; addressId: string },
    k: { itemId: string; regularId: string },
    method: 'CARD' | 'CASH_ON_DELIVERY',
    qty = 1,
  ) {
    await this.addToCart(c.token, k.itemId, [k.regularId], qty);
    const q = await this.call('post', '/checkout/quote', c.token, {
      fulfillment: 'DELIVERY',
      addressId: c.addressId,
    });
    const total = q.body.data.pricing.total as number;
    const res = await this.placeOrder(c, total, method);
    return { res, total, order: res.body.data?.order, payment: res.body.data?.payment };
  }

  async payOrder(token: string, providerRef: string) {
    return this.call('post', `/payments/sandbox/${providerRef}/complete`, token, {
      outcome: 'success',
    });
  }

  async totpCode(secret: string) {
    return totpAt(secret, Date.now());
  }
  newSecret() {
    return newTotpSecret();
  }
}
