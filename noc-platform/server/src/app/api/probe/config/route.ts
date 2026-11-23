import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { probeFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The probe asks for its work list every minute. Credentials for SNMP travel here,
// which is why the probe must use HTTPS to reach a production server.
export async function GET(req: Request) {
  const probe = await probeFromRequest(req);
  if (!probe) return NextResponse.json({ error: 'invalid probe token' }, { status: 401 });

  const url = new URL(req.url);
  await db.probe.update({
    where: { id: probe.id },
    data: {
      lastSeenAt: new Date(),
      version: url.searchParams.get('v')?.slice(0, 40) || probe.version,
      hostname: url.searchParams.get('host')?.slice(0, 120) || probe.hostname,
    },
  });

  const devices = await db.device.findMany({
    where: { probeId: probe.id, paused: false },
    include: { sensors: { where: { paused: false } } },
  });
  return NextResponse.json({
    probe: { id: probe.id, name: probe.name },
    sensors: devices.flatMap((d) => d.sensors.map((s) => ({
      id: s.id,
      type: s.type,
      intervalSec: Math.max(15, s.intervalSec),
      host: d.host,
      config: s.config,
      snmp: d.snmpVersion ? { version: d.snmpVersion, community: d.snmpCommunity, v3: d.snmpV3 } : null,
    }))),
  }, { headers: { 'cache-control': 'no-store' } });
}
