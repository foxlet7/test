'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { endSession, hashPassword, loginBlocked, loginFailed, loginSucceeded, newToken, requireUser, sha256, startSession, verifyPassword } from '@/lib/auth';
import { headers } from 'next/headers';

export type FormState = { error?: string; ok?: string; token?: string } | null;

const str = (max = 200) => z.string().trim().min(1).max(max);
const opt = (max = 200) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const num = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) { ctx.addIssue({ code: 'custom', message: 'not a number' }); return z.NEVER; }
  return n;
});
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
const fail = (e: z.ZodError): FormState => ({ error: e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });

// ----------------------------------------------------------------- first run + auth
export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if ((await db.user.count()) > 0) return { error: 'Setup is already done. Log in instead.' };
  const p = z.object({
    org: str(120), name: str(120), email: z.string().trim().toLowerCase().email(),
    password: z.string().min(10, 'at least 10 characters').max(200), currency: z.string().trim().length(3).default('SAR'),
  }).safeParse(form(fd));
  if (!p.success) return fail(p.error);
  const slug = p.data.org.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';
  const user = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: p.data.org, slug, currency: p.data.currency.toUpperCase() } });
    return tx.user.create({
      data: { tenantId: tenant.id, email: p.data.email, name: p.data.name, role: 'ADMIN', passwordHash: await hashPassword(p.data.password) },
    });
  });
  await startSession(user.id);
  redirect('/devices');
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const p = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse(form(fd));
  if (!p.success) return { error: 'Enter your email and password.' };
  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'local';
  if (loginBlocked(p.data.email, ip)) return { error: 'Too many failed attempts. Wait 15 minutes and try again.' };
  const u = await db.user.findUnique({ where: { email: p.data.email } });
  // same message and similar work for unknown user / wrong password
  const ok = u ? await verifyPassword(p.data.password, u.passwordHash) : (await hashPassword(p.data.password), false);
  if (!u || !ok) { loginFailed(p.data.email, ip); return { error: 'Email or password is wrong.' }; }
  loginSucceeded(p.data.email);
  await db.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  await startSession(u.id);
  redirect('/noc');
}

export async function logoutAction() {
  await endSession();
  redirect('/login');
}

// ----------------------------------------------------------------- sites
export async function createSite(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('OPERATOR');
  const p = z.object({ name: str(80), location: opt(120) }).safeParse(form(fd));
  if (!p.success) return fail(p.error);
  const exists = await db.site.findUnique({ where: { tenantId_name: { tenantId: u.tenantId, name: p.data.name } } });
  if (exists) return { error: `Site "${p.data.name}" already exists.` };
  await db.site.create({ data: { ...p.data, tenantId: u.tenantId } });
  revalidatePath('/devices');
  return { ok: `Site "${p.data.name}" added.` };
}

export async function deleteSite(fd: FormData) {
  const u = await requireUser('OPERATOR');
  await db.site.deleteMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId } });
  revalidatePath('/devices');
}

// ----------------------------------------------------------------- probes
export async function createProbe(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('ADMIN');
  const p = z.object({ name: str(80) }).safeParse(form(fd));
  if (!p.success) return fail(p.error);
  const token = 'nocp_' + newToken(30);
  await db.probe.create({ data: { tenantId: u.tenantId, name: p.data.name, tokenHash: sha256(token) } });
  revalidatePath('/probes');
  return { ok: `Probe "${p.data.name}" created. Copy the token now: it is shown only once.`, token };
}

export async function rotateProbeToken(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('ADMIN');
  const token = 'nocp_' + newToken(30);
  const r = await db.probe.updateMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId }, data: { tokenHash: sha256(token) } });
  if (!r.count) return { error: 'Probe not found.' };
  revalidatePath('/probes');
  return { ok: 'New token issued. The old one stops working immediately.', token };
}

export async function deleteProbe(fd: FormData) {
  const u = await requireUser('ADMIN');
  await db.probe.deleteMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId } });
  revalidatePath('/probes');
}

// ----------------------------------------------------------------- devices
const DeviceInput = z.object({
  name: str(120), host: str(253).regex(/^[A-Za-z0-9.:\-_]+$/, 'IP address or DNS name'),
  kind: z.string().trim().max(40).default('generic'),
  siteId: opt(40), probeId: opt(40),
  snmpVersion: z.enum(['', '2c', '3']).default(''),
  snmpCommunity: opt(120),
  v3user: opt(120), v3authProto: z.enum(['', 'SHA', 'SHA256', 'MD5']).default(''), v3authPass: opt(200),
  v3privProto: z.enum(['', 'AES', 'AES256', 'DES']).default(''), v3privPass: opt(200),
});

function snmpFields(d: z.infer<typeof DeviceInput>) {
  return {
    snmpVersion: d.snmpVersion || null,
    snmpCommunity: d.snmpVersion === '2c' ? d.snmpCommunity || 'public' : null,
    snmpV3: d.snmpVersion === '3'
      ? ({ user: d.v3user, authProto: d.v3authProto || null, authPass: d.v3authPass, privProto: d.v3privProto || null, privPass: d.v3privPass } as Prisma.InputJsonValue)
      : undefined,
  };
}

async function ownsRefs(tenantId: string, siteId: string | null, probeId: string | null) {
  if (siteId && !(await db.site.findFirst({ where: { id: siteId, tenantId } }))) return 'Unknown site.';
  if (probeId && !(await db.probe.findFirst({ where: { id: probeId, tenantId } }))) return 'Unknown probe.';
  return null;
}

export async function createDevice(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('OPERATOR');
  const p = DeviceInput.safeParse(form(fd));
  if (!p.success) return fail(p.error);
  const bad = await ownsRefs(u.tenantId, p.data.siteId, p.data.probeId);
  if (bad) return { error: bad };
  const d = await db.device.create({
    data: { tenantId: u.tenantId, name: p.data.name, host: p.data.host, kind: p.data.kind, siteId: p.data.siteId, probeId: p.data.probeId, ...snmpFields(p.data) },
  });
  // every device starts with a ping sensor: the cheapest, most useful check
  if (fd.get('addPing') === 'on') {
    await db.sensor.create({ data: { deviceId: d.id, name: 'Ping', type: 'PING', intervalSec: 60, warnAbove: 150, failAfter: 2, config: { count: 4 } } });
  }
  revalidatePath('/devices');
  redirect(`/devices/${d.id}`);
}

export async function updateDevice(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('OPERATOR');
  const id = String(fd.get('id'));
  const p = DeviceInput.safeParse(form(fd));
  if (!p.success) return fail(p.error);
  const bad = await ownsRefs(u.tenantId, p.data.siteId, p.data.probeId);
  if (bad) return { error: bad };
  const cur = await db.device.findFirst({ where: { id, tenantId: u.tenantId } });
  if (!cur) return { error: 'Device not found.' };
  const snmp = snmpFields(p.data);
  // keep stored v3 passwords when the edit form leaves them blank
  if (p.data.snmpVersion === '3' && cur.snmpV3 && typeof cur.snmpV3 === 'object') {
    const old = cur.snmpV3 as Record<string, unknown>;
    const nv = snmp.snmpV3 as Record<string, unknown>;
    if (!nv.authPass) nv.authPass = old.authPass;
    if (!nv.privPass) nv.privPass = old.privPass;
  }
  await db.device.update({
    where: { id },
    data: {
      name: p.data.name, host: p.data.host, kind: p.data.kind, siteId: p.data.siteId, probeId: p.data.probeId,
      snmpVersion: snmp.snmpVersion, snmpCommunity: snmp.snmpCommunity,
      snmpV3: p.data.snmpVersion === '3' ? snmp.snmpV3 : Prisma.DbNull,
    },
  });
  revalidatePath(`/devices/${id}`);
  return { ok: 'Saved.' };
}

export async function deleteDevice(fd: FormData) {
  const u = await requireUser('OPERATOR');
  await db.device.deleteMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId } });
  revalidatePath('/devices');
  redirect('/devices');
}

export async function toggleDevicePause(fd: FormData) {
  const u = await requireUser('OPERATOR');
  const d = await db.device.findFirst({ where: { id: String(fd.get('id')), tenantId: u.tenantId } });
  if (d) await db.device.update({ where: { id: d.id }, data: { paused: !d.paused } });
  revalidatePath(`/devices/${d?.id}`);
}

// ----------------------------------------------------------------- sensors
const SensorInput = z.object({
  deviceId: str(40), name: str(120),
  type: z.enum(['PING', 'SNMP_TRAFFIC', 'SNMP_OID', 'SNMP_UPTIME', 'HTTP', 'TCP', 'DNS']),
  intervalSec: z.coerce.number().int().min(15).max(3600).default(60),
  failAfter: z.coerce.number().int().min(1).max(10).default(2),
  warnAbove: num, downAbove: num, warnBelow: num, downBelow: num,
  // type-specific
  ifIndex: opt(10), ifName: opt(80), oid: opt(200), unit: opt(20), scale: num,
  url: opt(500), expectStatus: opt(10), keyword: opt(200), tlsWarnDays: num,
  port: opt(5), query: opt(253), expect: opt(200), count: opt(2),
});

function sensorConfig(d: z.infer<typeof SensorInput>): { config: Prisma.InputJsonValue; error?: string } {
  switch (d.type) {
    case 'PING': return { config: { count: Math.min(10, Math.max(1, Number(d.count) || 4)) } };
    case 'SNMP_TRAFFIC':
      if (!d.ifIndex && !d.ifName) return { config: {}, error: 'Give the interface index or name (e.g. wan1, GigabitEthernet0/1).' };
      return { config: { ifIndex: d.ifIndex ? Number(d.ifIndex) : null, ifName: d.ifName } };
    case 'SNMP_OID':
      if (!d.oid || !/^\.?\d+(\.\d+)+$/.test(d.oid)) return { config: {}, error: 'Enter a numeric OID like 1.3.6.1.4.1.12356.101.4.1.3.0' };
      return { config: { oid: d.oid.replace(/^\./, ''), unit: d.unit, scale: d.scale ?? 1 } };
    case 'SNMP_UPTIME': return { config: {} };
    case 'HTTP':
      if (!d.url || !/^https?:\/\//.test(d.url)) return { config: {}, error: 'Enter a URL starting with http:// or https://' };
      return { config: { url: d.url, expectStatus: d.expectStatus ? Number(d.expectStatus) : null, keyword: d.keyword, tlsWarnDays: d.tlsWarnDays ?? 14 } };
    case 'TCP': {
      const port = Number(d.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { config: {}, error: 'Port must be 1-65535.' };
      return { config: { port } };
    }
    case 'DNS':
      if (!d.query) return { config: {}, error: 'Enter the name to resolve.' };
      return { config: { query: d.query, expect: d.expect } };
  }
}

export async function createSensor(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('OPERATOR');
  const p = SensorInput.safeParse(form(fd));
  if (!p.success) return fail(p.error);
  const dev = await db.device.findFirst({ where: { id: p.data.deviceId, tenantId: u.tenantId } });
  if (!dev) return { error: 'Device not found.' };
  if (p.data.type.startsWith('SNMP') && !dev.snmpVersion) return { error: 'Set SNMP credentials on the device first (Edit device).' };
  const { config, error } = sensorConfig(p.data);
  if (error) return { error };
  await db.sensor.create({
    data: {
      deviceId: dev.id, name: p.data.name, type: p.data.type, config, intervalSec: p.data.intervalSec, failAfter: p.data.failAfter,
      warnAbove: p.data.warnAbove, downAbove: p.data.downAbove, warnBelow: p.data.warnBelow, downBelow: p.data.downBelow,
    },
  });
  revalidatePath(`/devices/${dev.id}`);
  return { ok: `Sensor "${p.data.name}" added. The probe picks it up within a minute.` };
}

export async function deleteSensor(fd: FormData) {
  const u = await requireUser('OPERATOR');
  const s = await db.sensor.findFirst({ where: { id: String(fd.get('id')), device: { tenantId: u.tenantId } } });
  if (s) await db.sensor.delete({ where: { id: s.id } });
  revalidatePath(`/devices/${s?.deviceId}`);
}

export async function toggleSensorPause(fd: FormData) {
  const u = await requireUser('OPERATOR');
  const s = await db.sensor.findFirst({ where: { id: String(fd.get('id')), device: { tenantId: u.tenantId } } });
  if (s) await db.sensor.update({ where: { id: s.id }, data: { paused: !s.paused, status: s.paused ? 'UNKNOWN' : 'PAUSED', statusSince: new Date() } });
  revalidatePath(`/devices/${s?.deviceId}`);
}

// ----------------------------------------------------------------- circuits (cost / SLA)
const CircuitInput = z.object({
  name: str(120), provider: str(80), circuitRef: opt(120), kind: z.string().trim().max(40).default('DIA'),
  siteId: opt(40), bandwidthMbps: num, monthlyCost: z.coerce.number().min(0).max(1e9), oneTimeCost: num,
  slaPct: num, creditPctPerBreach: num, contractStart: opt(10), contractEnd: opt(10),
  availSensorId: opt(40), trafficSensorId: opt(40), notes: opt(1000),
});

async function circuitData(tenantId: string, d: z.infer<typeof CircuitInput>) {
  for (const sid of [d.availSensorId, d.trafficSensorId]) {
    if (sid && !(await db.sensor.findFirst({ where: { id: sid, device: { tenantId } } }))) throw new Error('Unknown sensor.');
  }
  if (d.siteId && !(await db.site.findFirst({ where: { id: d.siteId, tenantId } }))) throw new Error('Unknown site.');
  if (d.slaPct != null && (d.slaPct <= 0 || d.slaPct > 100)) throw new Error('SLA % must be between 0 and 100.');
  return {
    name: d.name, provider: d.provider, circuitRef: d.circuitRef, kind: d.kind, siteId: d.siteId,
    bandwidthMbps: d.bandwidthMbps, monthlyCost: d.monthlyCost, oneTimeCost: d.oneTimeCost ?? 0,
    slaPct: d.slaPct, creditPctPerBreach: d.creditPctPerBreach,
    contractStart: d.contractStart ? new Date(d.contractStart) : null, contractEnd: d.contractEnd ? new Date(d.contractEnd) : null,
    availSensorId: d.availSensorId, trafficSensorId: d.trafficSensorId, notes: d.notes,
  };
}

export async function createCircuit(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('OPERATOR');
  const p = CircuitInput.safeParse(form(fd));
  if (!p.success) return fail(p.error);
  try {
    const data = await circuitData(u.tenantId, p.data);
    if (data.availSensorId && (await db.circuit.findUnique({ where: { availSensorId: data.availSensorId } }))) {
      return { error: 'That availability sensor already belongs to another circuit.' };
    }
    await db.circuit.create({ data: { ...data, tenantId: u.tenantId } });
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath('/circuits');
  return { ok: `Circuit "${p.data.name}" added.` };
}

export async function deleteCircuit(fd: FormData) {
  const u = await requireUser('OPERATOR');
  await db.circuit.deleteMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId } });
  revalidatePath('/circuits');
}

// ----------------------------------------------------------------- alerts + notifications
export async function ackAlert(fd: FormData) {
  const u = await requireUser('OPERATOR');
  await db.alertEvent.updateMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId, ackedAt: null }, data: { ackedAt: new Date(), ackedBy: u.name } });
  revalidatePath('/alerts');
}

export async function createChannel(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('ADMIN');
  const p = z.object({
    name: str(80), kind: z.enum(['webhook', 'teams']), target: z.string().trim().url().max(1000).refine((v) => v.startsWith('https://') || v.startsWith('http://'), 'http(s) URL'),
    minStatus: z.enum(['DOWN', 'WARNING']).default('DOWN'),
  }).safeParse(form(fd));
  if (!p.success) return fail(p.error);
  await db.notifyChannel.create({ data: { ...p.data, tenantId: u.tenantId } });
  revalidatePath('/settings');
  return { ok: `Channel "${p.data.name}" added.` };
}

export async function deleteChannel(fd: FormData) {
  const u = await requireUser('ADMIN');
  await db.notifyChannel.deleteMany({ where: { id: String(fd.get('id')), tenantId: u.tenantId } });
  revalidatePath('/settings');
}

export async function createUser(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser('ADMIN');
  const p = z.object({
    name: str(120), email: z.string().trim().toLowerCase().email(), role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']),
    password: z.string().min(10, 'at least 10 characters').max(200),
  }).safeParse(form(fd));
  if (!p.success) return fail(p.error);
  if (await db.user.findUnique({ where: { email: p.data.email } })) return { error: 'A user with that email already exists.' };
  await db.user.create({ data: { tenantId: u.tenantId, name: p.data.name, email: p.data.email, role: p.data.role, passwordHash: await hashPassword(p.data.password) } });
  revalidatePath('/settings');
  return { ok: `User ${p.data.email} added.` };
}

export async function deleteUser(fd: FormData) {
  const u = await requireUser('ADMIN');
  const id = String(fd.get('id'));
  if (id === u.id) return; // never lock yourself out
  await db.user.deleteMany({ where: { id, tenantId: u.tenantId } });
  revalidatePath('/settings');
}
