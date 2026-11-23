import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Everything the NOC wall needs in one request.
export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const [tenant, sites, devices, alerts, probes] = await Promise.all([
    db.tenant.findUnique({ where: { id: u.tenantId }, select: { name: true } }),
    db.site.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.device.findMany({
      where: { tenantId: u.tenantId },
      orderBy: { name: 'asc' },
      include: { sensors: { orderBy: { name: 'asc' } } },
    }),
    db.alertEvent.findMany({
      where: { tenantId: u.tenantId, ackedAt: null, to: { in: ['DOWN', 'WARNING'] }, sensor: { status: { in: ['DOWN', 'WARNING'] } } },
      orderBy: { at: 'desc' },
      take: 50,
      include: { sensor: { include: { device: { include: { site: true } } } } },
    }),
    db.probe.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true, lastSeenAt: true } }),
  ]);
  // only the newest open alert per sensor
  const seen = new Set<string>();
  const open = alerts.filter((a) => (seen.has(a.sensorId) ? false : (seen.add(a.sensorId), true)));
  return NextResponse.json({
    tenant: tenant?.name,
    at: new Date().toISOString(),
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
    devices: devices.map((d) => ({
      id: d.id, name: d.name, host: d.host, siteId: d.siteId, paused: d.paused,
      sensors: d.sensors.map((s) => ({
        id: s.id, name: s.name, type: s.type, status: d.paused || s.paused ? 'PAUSED' : s.status,
        lastText: s.lastText, lastMessage: s.lastMessage, statusSince: s.statusSince, lastCheckAt: s.lastCheckAt,
      })),
    })),
    alerts: open.map((a) => ({
      id: a.id, to: a.to, at: a.at, message: a.message,
      sensor: a.sensor.name, device: a.sensor.device.name, site: a.sensor.device.site?.name ?? null,
    })),
    probes,
  }, { headers: { 'cache-control': 'no-store' } });
}
