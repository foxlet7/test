'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Status = 'UNKNOWN' | 'UP' | 'WARNING' | 'DOWN' | 'PAUSED';
type Sensor = { id: string; name: string; type: string; status: Status; lastText: string | null; lastMessage: string | null; statusSince: string | null; lastCheckAt: string | null };
type Device = { id: string; name: string; host: string; siteId: string | null; paused: boolean; sensors: Sensor[] };
type Alert = { id: string; to: Status; at: string; message: string | null; sensor: string; device: string; site: string | null };
type State = { tenant: string; at: string; sites: { id: string; name: string }[]; devices: Device[]; alerts: Alert[]; probes: { id: string; name: string; lastSeenAt: string | null }[] };

const RANK: Record<Status, number> = { DOWN: 0, WARNING: 1, UNKNOWN: 2, UP: 3, PAUSED: 4 };
const worst = (l: Status[]) => l.reduce<Status>((w, s) => (RANK[s] < RANK[w] ? s : w), 'PAUSED');
// value shown on the wall: traffic first, then latency, then whatever the first sensor says
const PRIMARY = ['SNMP_TRAFFIC', 'PING', 'HTTP', 'TCP', 'SNMP_OID', 'DNS', 'SNMP_UPTIME'];

function ago(iso: string | null) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}

function deviceView(d: Device) {
  const sens = d.sensors.map((s) => ({ ...s, status: (d.paused ? 'PAUSED' : s.status) as Status }));
  const st: Status = sens.length ? worst(sens.map((s) => s.status)) : 'UNKNOWN';
  const bad = sens.filter((s) => s.status === 'DOWN' || s.status === 'WARNING');
  const primary = [...sens].sort((a, b) => PRIMARY.indexOf(a.type) - PRIMARY.indexOf(b.type))[0];
  const worstBad = bad.sort((a, b) => RANK[a.status] - RANK[b.status])[0];
  return {
    st,
    value: worstBad ? ago(worstBad.statusSince) : primary?.lastText || (sens.length ? '-' : 'no sensors'),
    why: worstBad ? `${worstBad.name}: ${worstBad.lastMessage || worstBad.status.toLowerCase()}` : null,
    sub: `${d.host}${sens.length > 1 ? ' · ' + sens.length + ' sensors' : ''}`,
  };
}

export function Wall() {
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    let gotOne = false;
    const load = async () => {
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        if (r.status === 401) { window.location.href = '/login'; return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = (await r.json()) as State;
        if (!alive) return;
        setState(j); setErr(''); setLastOk(Date.now()); gotOne = true;
      } catch (e) {
        if (alive) setErr((e as Error).message);
      } finally {
        // fast retries until the first good load, then every 15 s
        if (alive) timer = setTimeout(load, gotOne ? 15000 : 4000);
      }
    };
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  }, []);

  const groups = useMemo(() => {
    if (!state) return [];
    const list = [...state.sites, { id: '', name: 'Other' }].map((s) => {
      const devices = state.devices.filter((d) => (d.siteId || '') === s.id).map((d) => ({ d, v: deviceView(d) }))
        .sort((a, b) => RANK[a.v.st] - RANK[b.v.st] || a.d.name.localeCompare(b.d.name));
      return { ...s, devices, st: devices.length ? worst(devices.map((x) => x.v.st)) : ('UNKNOWN' as Status) };
    });
    return list.filter((g) => g.devices.length);
  }, [state]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { DOWN: 0, WARNING: 0, UNKNOWN: 0, UP: 0, PAUSED: 0 };
    state?.devices.forEach((d) => d.sensors.forEach((s) => { c[d.paused ? 'PAUSED' : s.status]++; }));
    return c;
  }, [state]);

  const stale = lastOk && now - lastOk > 60000;
  const clock = new Date(now);
  const offline = state?.probes.filter((p) => !p.lastSeenAt || now - new Date(p.lastSeenAt).getTime() > 180000) || [];

  return (
    <div className={'wall' + (stale ? ' stale' : '')}>
      <header className="wall-top">
        <div className="brand">noc<b>platform</b></div>
        <div className="wall-title"><b>{state?.tenant || 'NOC'}</b><span>{err && !state ? 'Connecting…' : stale ? `Data stale: last update ${ago(new Date(lastOk).toISOString())} ago` : 'live'}</span></div>
        <div className="wall-counts">
          {(['DOWN', 'WARNING', 'UNKNOWN', 'PAUSED', 'UP'] as Status[]).map((k) => (
            <span key={k} className={'wc s-' + k + (counts[k] ? ' hot' : ' zero')}><b>{counts[k]}</b> {k === 'UNKNOWN' ? 'Unknown' : k[0] + k.slice(1).toLowerCase()}</span>
          ))}
        </div>
        <Link className="btn ghost small wall-admin" href="/devices">Manage</Link>
        <div className="wall-clock"><b>{clock.toLocaleTimeString([], { hour12: false })}</b><span>{clock.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      </header>
      {(err && state) || offline.length ? (
        <div className="wall-banner">
          {err && state ? `Last refresh failed (${err}). ` : ''}
          {offline.length ? `Probe offline: ${offline.map((p) => p.name).join(', ')}: its devices are not being checked.` : ''}
        </div>
      ) : null}
      <main className="wall-main">
        <section className="wall-groups">
          {state && groups.length === 0 && (
            <div className="card"><div className="empty"><b>Nothing to show yet</b>Add a probe and devices under <Link href="/devices">Manage</Link>.</div></div>
          )}
          {groups.map((g) => (
            <section key={g.id || 'other'} className={'wpanel s-' + g.st}>
              <div className="wpanel-head">
                <h2>{g.name}</h2>
                {g.st === 'DOWN' || g.st === 'WARNING'
                  ? <span className={'badge s-' + g.st}>{g.devices.filter((x) => x.v.st === 'DOWN' || x.v.st === 'WARNING').length} {g.st.toLowerCase()}</span>
                  : <span className="wmeta">{g.devices.length} {g.devices.length === 1 ? 'device' : 'devices'}</span>}
              </div>
              <div className="health" aria-hidden="true">{g.devices.map((x) => <i key={x.d.id} className={'s-' + x.v.st} />)}</div>
              <ul className="wrows">
                {g.devices.map(({ d, v }) => (
                  <li key={d.id} className={'wrow s-' + v.st}>
                    <span className="dot" />
                    <Link href={`/devices/${d.id}`} className="wlbl">
                      <span className="wname">{d.name}</span>
                      <span className="wsub">{v.sub}</span>
                      {v.why && <span className="wwhy">{v.why}</span>}
                    </Link>
                    <span className="wval">{v.st === 'DOWN' || v.st === 'WARNING' ? <><small>{v.st.toLowerCase()} </small>{v.value}</> : v.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
        <aside className="wall-alerts">
          <div className="wpanel-head"><h2>Active alerts</h2><span className={'badge ' + (state?.alerts.length ? 's-DOWN' : 's-UP')}>{state?.alerts.length ?? 0}</span></div>
          <ol>
            {state && state.alerts.length === 0 && <li className="all-clear">All clear</li>}
            {state?.alerts.map((a) => (
              <li key={a.id} className={'walert s-' + a.to}>
                <div><span className={'badge s-' + a.to}>{a.to}</span> <b>{a.device}</b> <span className="wsince">{ago(a.at)}</span></div>
                <div>{a.sensor}</div>
                {a.message && <div className="wsub">{a.message}</div>}
                {a.site && <div className="wsub">{a.site}</div>}
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}
