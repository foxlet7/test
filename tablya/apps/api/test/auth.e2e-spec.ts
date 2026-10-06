import { Harness, uniq } from './harness';

describe('Authentication & account lifecycle', () => {
  const h = new Harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('registers, rejects duplicates and weak passwords, and never allows self-assigned staff roles', async () => {
    const email = `a-${uniq()}@example.com`;
    const ok = await h.req().post('/auth/register').send({ email, password: 'CorrectHorse9', name: 'A' });
    expect(ok.status).toBe(201);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.user.roles).toEqual(['CUSTOMER']);
    expect(ok.body.data.user.passwordHash).toBeUndefined();

    const dup = await h.req().post('/auth/register').send({ email, password: 'CorrectHorse9', name: 'A' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');

    const weak = await h.req().post('/auth/register').send({ email: `w-${uniq()}@example.com`, password: 'short', name: 'A' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');

    const admin = await h.req().post('/auth/register').send({ email: `x-${uniq()}@example.com`, password: 'CorrectHorse9', name: 'A', role: 'ADMIN' });
    expect(admin.status).toBe(400);
  });

  it('stores passwords hashed (argon2id), never plaintext', async () => {
    const u = await h.register();
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(u.password);
  });

  it('login: wrong password and unknown email give the same generic error', async () => {
    const u = await h.register();
    const bad = await h.req().post('/auth/login').send({ email: u.email, password: 'WrongPassword1' });
    const unknown = await h.req().post('/auth/login').send({ email: `nobody-${uniq()}@example.com`, password: 'WrongPassword1' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toEqual({ ...bad.body.error, requestId: unknown.body.error.requestId });
    const good = await h.req().post('/auth/login').send({ email: u.email, password: u.password });
    expect(good.status).toBe(200);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const u = await h.register();
    for (let i = 0; i < 5; i++) await h.req().post('/auth/login').send({ email: u.email, password: 'WrongPassword1' });
    const locked = await h.req().post('/auth/login').send({ email: u.email, password: u.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
  });

  it('protected routes require a token; garbage and expired tokens are rejected', async () => {
    expect((await h.call('get', '/me')).status).toBe(401);
    expect((await h.call('get', '/me', 'garbage')).status).toBe(401);
    const jwt = require('jsonwebtoken');
    const u = await h.register();
    const expired = jwt.sign({ sub: u.id, roles: ['CUSTOMER'], sid: 'x' }, process.env.JWT_ACCESS_SECRET, { expiresIn: -10, issuer: 'tablya' });
    const r = await h.call('get', '/me', expired);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TOKEN_EXPIRED');
    const wrongAlg = jwt.sign({ sub: u.id, roles: ['ADMIN'], sid: 'x' }, 'other-secret-other-secret-other-secret!!', { issuer: 'tablya' });
    expect((await h.call('get', '/me', wrongAlg)).status).toBe(401);
  });

  it('refresh rotates tokens; reusing a spent refresh token revokes the whole session family', async () => {
    const u = await h.register();
    const r1 = await h.req().post('/auth/refresh').send({ refreshToken: u.refresh });
    expect(r1.status).toBe(200);
    const newAccess = r1.body.data.accessToken;
    const newRefresh = r1.body.data.refreshToken;
    expect(newRefresh).not.toBe(u.refresh);
    expect((await h.call('get', '/me', newAccess)).status).toBe(200);

    const replay = await h.req().post('/auth/refresh').send({ refreshToken: u.refresh }); // stolen/old token
    expect(replay.status).toBe(401);
    // family revoked: even the legitimately rotated token and access token stop working
    expect((await h.req().post('/auth/refresh').send({ refreshToken: newRefresh })).status).toBe(401);
    expect((await h.call('get', '/me', newAccess)).status).toBe(401);
  });

  it('concurrent refreshes with the same token: exactly one wins', async () => {
    const u = await h.register();
    const rs = await Promise.all([1, 2, 3, 4].map(() => h.req().post('/auth/refresh').send({ refreshToken: u.refresh })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('logout invalidates the access token immediately', async () => {
    const u = await h.register();
    expect((await h.call('post', '/auth/logout', u.token)).status).toBe(200);
    expect((await h.call('get', '/me', u.token)).status).toBe(401);
    expect((await h.req().post('/auth/refresh').send({ refreshToken: u.refresh })).status).toBe(401);
  });

  it('password reset: generic response, single-use code, revokes sessions, new password works', async () => {
    const u = await h.register();
    const unknown = await h.req().post('/auth/forgot-password').send({ email: `ghost-${uniq()}@example.com` });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.devCode).toBeUndefined(); // no existence oracle

    const f = await h.req().post('/auth/forgot-password').send({ email: u.email });
    const code = f.body.data.devCode;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await h.req().post('/auth/reset-password').send({ email: u.email, code: '000000', newPassword: 'BrandNewPass1' });
    expect(wrong.status).toBe(400);
    const ok = await h.req().post('/auth/reset-password').send({ email: u.email, code, newPassword: 'BrandNewPass1' });
    expect(ok.status).toBe(200);
    expect((await h.req().post('/auth/reset-password').send({ email: u.email, code, newPassword: 'AnotherPass22' })).status).toBe(400); // single use
    expect((await h.call('get', '/me', u.token)).status).toBe(401); // old session dead
    expect((await h.req().post('/auth/login').send({ email: u.email, password: u.password })).status).toBe(401);
    expect((await h.req().post('/auth/login').send({ email: u.email, password: 'BrandNewPass1' })).status).toBe(200);
  });

  it('phone OTP verification works and is attempt-limited', async () => {
    const u = await h.register();
    const phone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    expect((await h.call('patch', '/me', u.token, { phone })).status).toBe(200);
    const req = await h.call('post', '/auth/phone/request-otp', u.token);
    const code = req.body.data.devCode;
    for (let i = 0; i < 5; i++) await h.call('post', '/auth/phone/verify', u.token, { code: '111111' });
    expect((await h.call('post', '/auth/phone/verify', u.token, { code })).status).toBe(400); // locked out after 5 attempts
  });

  it('suspended accounts are locked out immediately (existing tokens too)', async () => {
    const u = await h.register();
    const admin = await h.createStaff(['ADMIN']);
    expect((await h.call('post', `/admin/users/${u.id}/suspend`, admin.token, { reason: 'fraud' })).status).toBe(200);
    const r = await h.call('get', '/me', u.token);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ACCOUNT_SUSPENDED');
    const login = await h.req().post('/auth/login').send({ email: u.email, password: u.password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await h.call('post', `/admin/users/${u.id}/reinstate`, admin.token, { reason: 'resolved' })).status).toBe(200);
    expect((await h.req().post('/auth/login').send({ email: u.email, password: u.password })).status).toBe(200);
  });

  it('account deletion anonymises personal data, keeps orders, and kills the account', async () => {
    const u = await h.register();
    await h.call('post', '/me/addresses', u.token, { line1: 'Secret St', city: 'Riyadh', lat: 24.7, lng: 46.7 });
    const wrongPw = await h.call('delete', '/auth/account', u.token, { password: 'nope-nope-nope' });
    expect(wrongPw.status).toBe(401);
    expect((await h.call('delete', '/auth/account', u.token, { password: u.password })).status).toBe(200);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ email: null, phone: null, passwordHash: null, name: 'Deleted user', status: 'DELETED' });
    expect(await h.prisma.address.count({ where: { userId: u.id } })).toBe(0);
    expect((await h.call('get', '/me', u.token)).status).toBe(401);
    expect((await h.req().post('/auth/login').send({ email: u.email, password: u.password })).status).toBe(401);
    // the email can be re-registered by someone else
    expect((await h.req().post('/auth/register').send({ email: u.email, password: 'CorrectHorse9', name: 'New' })).status).toBe(201);
  });

  it('staff MFA: enrol TOTP, then login requires a valid code', async () => {
    const s = await h.createStaff(['ADMIN']);
    const enroll = await h.call('post', '/auth/totp/enroll', s.token);
    const secret = enroll.body.data.secret as string;
    expect((await h.call('post', '/auth/totp/activate', s.token, { code: '000000' })).status).toBe(400);
    expect((await h.call('post', '/auth/totp/activate', s.token, { code: await h.totpCode(secret) })).status).toBe(200);
    const noCode = await h.req().post('/auth/login').send({ email: s.email, password: s.password });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');
    const bad = await h.req().post('/auth/login').send({ email: s.email, password: s.password, totp: '123456' });
    expect(bad.status).toBe(401);
    const good = await h.req().post('/auth/login').send({ email: s.email, password: s.password, totp: await h.totpCode(secret) });
    expect(good.status).toBe(200);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.totpSecretEnc).not.toContain(secret); // encrypted at rest
  });

  it('errors never leak stack traces and always carry a request id', async () => {
    const r = await h.call('get', '/kitchens/not-a-real-kitchen');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(r.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts|node_modules|stack/i);
    expect(r.headers['x-request-id']).toBe(r.body.error.requestId);
  });

  it('exposes health and readiness', async () => {
    expect((await h.req().get('/health')).body.status).toBe('ok');
    const r = await h.req().get('/readiness');
    expect(r.status).toBe(200);
    expect(r.body.checks.database.ok).toBe(true);
  });
});
