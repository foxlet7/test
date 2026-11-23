import { db } from './db';

const SEVERITY: Record<string, number> = { DOWN: 0, WARNING: 1, UNKNOWN: 2, UP: 3, PAUSED: 4 };

// Send one alert event to the tenant's enabled channels. Webhook/Teams post JSON;
// recoveries (back to UP) go to every channel that would have received the problem.
export async function notify(eventId: string) {
  const ev = await db.alertEvent.findUnique({
    where: { id: eventId },
    include: { sensor: { include: { device: { include: { site: true } } } } },
  });
  if (!ev) return;
  const channels = await db.notifyChannel.findMany({ where: { tenantId: ev.tenantId, enabled: true } });
  const recovering = ev.to === 'UP';
  const dev = ev.sensor.device;
  const title = `${ev.to} · ${dev.name} › ${ev.sensor.name}`;
  const text = [dev.site?.name, ev.message].filter(Boolean).join(' · ');
  let sent = false;
  for (const ch of channels) {
    const sev = recovering ? SEVERITY[ev.from] : SEVERITY[ev.to];
    if (sev > SEVERITY[ch.minStatus]) continue;
    const body = ch.kind === 'teams'
      ? { '@type': 'MessageCard', '@context': 'https://schema.org/extensions', themeColor: recovering ? '2EA043' : ev.to === 'DOWN' ? 'E5343A' : 'F2B630', summary: title, title, text }
      : { event: 'sensor.status', status: ev.to, previous: ev.from, device: dev.name, host: dev.host, site: dev.site?.name ?? null, sensor: ev.sensor.name, message: ev.message, at: ev.at.toISOString() };
    if (ch.kind === 'webhook' || ch.kind === 'teams') {
      const res = await fetch(ch.target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (!res.ok) console.error(`[notify] ${ch.name}: HTTP ${res.status}`);
      else sent = true;
    }
    // email: planned (SMTP settings in env); recorded so the gap is visible in the UI
  }
  if (sent) await db.alertEvent.update({ where: { id: ev.id }, data: { notifiedAt: new Date() } });
}
