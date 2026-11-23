import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Recent measurements for a sensor graph (default 24 h, max 31 days).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const { id } = await ctx.params;
  const sensor = await db.sensor.findFirst({ where: { id, device: { tenantId: u.tenantId } }, select: { id: true } });
  if (!sensor) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const hours = Math.min(744, Math.max(1, Number(new URL(req.url).searchParams.get('hours')) || 24));
  const rows = await db.measurement.findMany({
    where: { sensorId: id, ts: { gte: new Date(Date.now() - hours * 3600e3) } },
    orderBy: { ts: 'asc' },
    select: { ts: true, value: true, ok: true, extra: true },
    take: 20000,
  });
  return NextResponse.json({ rows });
}
