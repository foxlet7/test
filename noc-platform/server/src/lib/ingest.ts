import type { Prisma, Sensor, Status } from '@prisma/client';
import { db } from './db';
import { evaluate } from './status';
import { fmtValue } from './format';
import { notify } from './notify';

export interface ProbeResult {
  sensorId: string;
  ts: string;          // ISO time of the check (probe clock)
  ok: boolean;
  value?: number | null;
  message?: string | null;
  warn?: boolean | null;
  extra?: Record<string, number | string | boolean> | null;
}

const UNIT: Record<string, string> = { PING: 'ms', HTTP: 'ms', TCP: 'ms', DNS: 'ms', SNMP_TRAFFIC: 'Mbit/s', SNMP_UPTIME: 'h' };

export function unitOf(s: Pick<Sensor, 'type' | 'config'>): string {
  const c = (s.config || {}) as { unit?: string };
  return c.unit || UNIT[s.type] || '';
}

// Store results from one probe and move each sensor's state. Only sensors on devices
// assigned to this probe are accepted, so a stolen probe token cannot write elsewhere.
export async function ingest(probeId: string, tenantId: string, results: ProbeResult[]) {
  if (!results.length) return { accepted: 0 };
  const ids = [...new Set(results.map((r) => r.sensorId))];
  const sensors = await db.sensor.findMany({
    where: { id: { in: ids }, device: { probeId, tenantId } },
  });
  const byId = new Map(sensors.map((s) => [s.id, s]));
  const rows: Prisma.MeasurementCreateManyInput[] = [];
  const now = Date.now();
  const sorted = results.filter((r) => byId.has(r.sensorId)).sort((a, b) => a.ts.localeCompare(b.ts));

  for (const r of sorted) {
    const s = byId.get(r.sensorId)!;
    let ts = new Date(r.ts);
    if (!Number.isFinite(ts.getTime()) || Math.abs(ts.getTime() - now) > 7 * 864e5) ts = new Date(now); // bad probe clock
    rows.push({ sensorId: s.id, ts, value: r.value ?? null, ok: r.ok, extra: (r.extra ?? undefined) as Prisma.InputJsonValue | undefined });
    if (s.paused) continue;
    const next = evaluate(s, { status: s.status as Status, failCount: s.failCount }, r);
    const changed = next.status !== s.status;
    const updated = await db.sensor.update({
      where: { id: s.id },
      data: {
        status: next.status,
        failCount: next.failCount,
        lastMessage: next.message,
        lastCheckAt: ts,
        ...(r.ok && r.value != null ? { lastValue: r.value, lastText: fmtValue(r.value, unitOf(s)) } : {}),
        ...(changed ? { statusSince: ts } : {}),
      },
    });
    byId.set(s.id, updated);
    if (changed && !(s.status === 'UNKNOWN' && next.status === 'UP')) {
      const ev = await db.alertEvent.create({
        data: { tenantId, sensorId: s.id, from: s.status, to: next.status, message: next.message, at: ts },
      });
      notify(ev.id).catch((e) => console.error('[notify]', e.message));
    }
  }
  if (rows.length) await db.measurement.createMany({ data: rows, skipDuplicates: true });
  return { accepted: rows.length, rejected: results.length - rows.length };
}
