import { NextResponse } from 'next/server';
import { z } from 'zod';
import { probeFromRequest } from '@/lib/auth';
import { ingest } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

const Result = z.object({
  sensorId: z.string().min(1).max(40),
  ts: z.string().max(40),
  ok: z.boolean(),
  value: z.number().finite().nullable().optional(),
  message: z.string().max(500).nullable().optional(),
  warn: z.boolean().nullable().optional(),
  extra: z.record(z.union([z.number(), z.string().max(200), z.boolean()])).nullable().optional(),
});
const Body = z.object({ results: z.array(Result).max(5000) });

export async function POST(req: Request) {
  const probe = await probeFromRequest(req);
  if (!probe) return NextResponse.json({ error: 'invalid probe token' }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid results', issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const out = await ingest(probe.id, probe.tenantId, parsed.data.results);
  return NextResponse.json(out);
}
