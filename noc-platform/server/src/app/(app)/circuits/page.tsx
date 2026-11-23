import Link from 'next/link';
import { requireUser, can } from '@/lib/auth';
import { db } from '@/lib/db';
import { availability, economics, type Sample, type TrafficSample } from '@/lib/billing';
import { fmtDuration, fmtMoney, fmtPct } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { createCircuit, deleteCircuit } from '@/app/actions';

function monthRange(m?: string) {
  const now = new Date();
  const [y, mo] = m && /^\d{4}-\d{2}$/.test(m) ? m.split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = Date.UTC(y, mo - 1, 1);
  const end = Math.min(Date.UTC(y, mo, 1), Date.now());
  return { start, end, label: new Date(start).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), key: `${y}-${String(mo).padStart(2, '0')}`, partial: end < Date.UTC(y, mo, 1) };
}

export default async function Circuits({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const u = await requireUser();
  const { month } = await searchParams;
  const r = monthRange(month);
  const [tenant, circuits, sites, sensors] = await Promise.all([
    db.tenant.findUnique({ where: { id: u.tenantId } }),
    db.circuit.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ siteId: 'asc' }, { name: 'asc' }], include: { site: true, availSensor: { include: { device: true } } } }),
    db.site.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } }),
    db.sensor.findMany({ where: { device: { tenantId: u.tenantId } }, include: { device: true }, orderBy: [{ device: { name: 'asc' } }, { name: 'asc' }] }),
  ]);
  const cur = tenant?.currency || 'SAR';
  const money = (v: number | null | undefined) => fmtMoney(v, cur);

  const rows = await Promise.all(circuits.map(async (c) => {
    const [avail, traffic] = await Promise.all([
      c.availSensorId ? db.measurement.findMany({ where: { sensorId: c.availSensorId, ts: { gte: new Date(r.start), lt: new Date(r.end) } }, select: { ts: true, ok: true }, orderBy: { ts: 'asc' } }) : [],
      c.trafficSensorId ? db.measurement.findMany({ where: { sensorId: c.trafficSensorId, ok: true, ts: { gte: new Date(r.start), lt: new Date(r.end) } }, select: { ts: true, extra: true }, orderBy: { ts: 'asc' } }) : [],
    ]);
    const samples: Sample[] = avail.map((m) => ({ ts: m.ts.getTime(), ok: m.ok }));
    const a = availability(samples, r.start, r.end, c.availSensor?.intervalSec ?? 60);
    const t: TrafficSample[] = traffic
      .map((m) => ({ ts: m.ts.getTime(), inMbps: Number((m.extra as Record<string, unknown> | null)?.inMbps), outMbps: Number((m.extra as Record<string, unknown> | null)?.outMbps) }))
      .filter((x) => Number.isFinite(x.inMbps) && Number.isFinite(x.outMbps));
    return { c, a, e: economics(c, a, t), measured: samples.length > 0 };
  }));

  const spend = rows.reduce((s, x) => s + x.e.periodCost, 0);
  const monthly = circuits.reduce((s, c) => s + c.monthlyCost, 0);
  const credits = rows.reduce((s, x) => s + x.e.creditDue, 0);
  const downCost = rows.reduce((s, x) => s + x.e.downtimeCost, 0);
  const breaches = rows.filter((x) => x.e.slaMet === false).length;
  const expiring = circuits.filter((c) => c.contractEnd && c.contractEnd.getTime() - Date.now() < 60 * 864e5 && c.contractEnd.getTime() > Date.now());
  const prev = new Date(r.start); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

  return (
    <>
      <div className="page-head">
        <div><h1>Circuits &amp; cost</h1><div className="sub">{r.label}{r.partial ? ' (to date)' : ''} · costs excl. VAT · availability measured by your probes</div></div>
        <div className="actions">
          <Link className="btn ghost" href={`?month=${prevKey}`}>← Previous month</Link>
          {month && <Link className="btn ghost" href="/circuits">This month</Link>}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi accent"><div className="n">{money(monthly)}</div><div className="l">Monthly link spend ({circuits.length} circuits)</div></div>
        <div className="kpi"><div className="n">{money(spend)}</div><div className="l">Cost for this period</div></div>
        <div className={'kpi ' + (downCost > 0 ? 'bad' : 'good')}><div className="n">{money(downCost)}</div><div className="l">Paid for downtime</div></div>
        <div className={'kpi ' + (breaches ? 'bad' : 'good')}><div className="n">{breaches}</div><div className="l">SLA breaches</div></div>
        <div className={'kpi ' + (credits ? 'accent' : '')}><div className="n">{money(credits)}</div><div className="l">Credits to claim</div></div>
      </div>
      {expiring.length > 0 && <div className="notice" style={{ marginBottom: '1rem' }}>Contract ending within 60 days: {expiring.map((c) => `${c.name} (${c.contractEnd!.toISOString().slice(0, 10)})`).join(', ')}. Renegotiate with the usage figures below.</div>}

      <section className="card">
        <div className="card-head"><h2>Circuits</h2></div>
        {circuits.length === 0 ? <div className="empty"><b>No circuits yet</b>Add your ISP links with their monthly cost and SLA below.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th>Circuit</th><th className="r">Bandwidth</th><th className="r">Monthly</th><th className="r">Per Mbit/s</th>
                <th className="r">Availability</th><th className="r">Down</th><th className="r">SLA</th><th className="r">Credit</th>
                <th className="r">p95 use</th><th className="r">Per used Mbit/s</th>{can(u, 'OPERATOR') && <th />}
              </tr></thead>
              <tbody>
                {rows.map(({ c, a, e, measured }) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><div className="muted">{c.provider} · {c.kind}{c.site ? ' · ' + c.site.name : ''}{c.circuitRef ? ' · ' + c.circuitRef : ''}</div>
                      {!c.availSensorId && <div className="muted" style={{ color: 'var(--warn)' }}>No availability sensor linked</div>}</td>
                    <td className="r">{c.bandwidthMbps ? c.bandwidthMbps + ' Mb' : '-'}</td>
                    <td className="r">{money(c.monthlyCost)}</td>
                    <td className="r">{money(e.costPerMbps)}</td>
                    <td className="r" title={measured ? `monitored ${a.coveragePct.toFixed(0)}% of the period` : 'no data'}>{measured ? fmtPct(a.availabilityPct) : 'n/a'}{measured && a.coveragePct < 95 && <div className="muted">{a.coveragePct.toFixed(0)}% monitored</div>}</td>
                    <td className="r">{measured ? fmtDuration(a.downSecs) : '-'}{e.downtimeCost > 0 && <div className="muted">{money(e.downtimeCost)}</div>}</td>
                    <td className="r">{c.slaPct ? (
                      <span className={'badge s-' + (e.slaMet === false ? 'DOWN' : e.slaMet ? 'UP' : 'UNKNOWN')} title={e.slaMet == null && measured ? 'An SLA verdict needs at least 90% of the period monitored' : undefined}>
                        {c.slaPct}% {e.slaMet === false ? 'missed' : e.slaMet ? 'met' : measured ? 'not enough data' : ''}
                      </span>
                    ) : '-'}</td>
                    <td className="r">{e.creditDue ? <b style={{ color: 'var(--accent)' }}>{money(e.creditDue)}</b> : '-'}</td>
                    <td className="r">{e.p95UtilPct != null ? e.p95UtilPct.toFixed(0) + '%' : '-'}</td>
                    <td className="r">{money(e.costPerUsedMbps)}</td>
                    {can(u, 'OPERATOR') && <td className="r"><form action={deleteCircuit}><input type="hidden" name="id" value={c.id} /><button className="btn danger small" aria-label={'Delete ' + c.name}>Delete</button></form></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {can(u, 'OPERATOR') && (
        <section className="card">
          <div className="card-head"><h2>Add circuit</h2></div>
          <div className="card-body">
            <ActionForm action={createCircuit} submit="Add circuit">
              <div className="row2">
                <label>Name<input name="name" required maxLength={120} placeholder="(054) STC 120 Mb DIA" /></label>
                <label>Provider<input name="provider" required maxLength={80} placeholder="STC" list="providers" /></label>
                <datalist id="providers"><option>STC</option><option>Mobily</option><option>Zain</option><option>GO Telecom</option><option>Dawiyat</option><option>Salam</option></datalist>
                <label>Type<select name="kind">{['DIA', 'Broadband', 'IPVPN', 'MPLS', 'P2P', 'SD-WAN underlay', '5G/LTE', 'SIP trunk'].map((k) => <option key={k}>{k}</option>)}</select></label>
                <label>Circuit ref.<input name="circuitRef" maxLength={120} /></label>
              </div>
              <div className="row2">
                <label>Site<select name="siteId"><option value="">(none)</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label>Bandwidth (Mbit/s)<input name="bandwidthMbps" inputMode="decimal" /></label>
                <label>Monthly cost ({cur})<input name="monthlyCost" inputMode="decimal" required /></label>
                <label>One-time cost ({cur})<input name="oneTimeCost" inputMode="decimal" /></label>
              </div>
              <div className="row2">
                <label>SLA availability %<input name="slaPct" inputMode="decimal" placeholder="99.5" /></label>
                <label>Credit per breach (% of fee)<input name="creditPctPerBreach" inputMode="decimal" placeholder="10" /></label>
                <label>Contract start<input name="contractStart" type="date" /></label>
                <label>Contract end<input name="contractEnd" type="date" /></label>
              </div>
              <div className="row2">
                <label>Availability measured by <span className="hint">best: ping to the carrier gateway</span>
                  <select name="availSensorId"><option value="">(none)</option>{sensors.filter((s) => s.type !== 'SNMP_TRAFFIC').map((s) => <option key={s.id} value={s.id}>{s.device.name} › {s.name}</option>)}</select></label>
                <label>Utilisation from <span className="hint">SNMP traffic sensor</span>
                  <select name="trafficSensorId"><option value="">(none)</option>{sensors.filter((s) => s.type === 'SNMP_TRAFFIC').map((s) => <option key={s.id} value={s.id}>{s.device.name} › {s.name}</option>)}</select></label>
              </div>
              <label>Notes<textarea name="notes" rows={2} maxLength={1000} /></label>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
