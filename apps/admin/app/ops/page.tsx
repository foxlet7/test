'use client';
import { useState } from 'react';
import { api, getSession } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

export default function Ops() {
  const roles = getSession()?.roles ?? [];
  const isSuper = roles.includes('super_admin');
  const isAud = isSuper || roles.includes('auditor');
  const flags = useApi<{ flags: any[] }>('/admin/flags');
  const retention = useApi<any>('/admin/retention');
  const invites = useApi<{ invites: any[] }>(isSuper ? '/admin/invites' : null);
  const audit = useApi<{ entries: any[] }>(isAud ? '/admin/audit?limit=100' : null);
  const queue = useApi<{ open: any[] }>('/admin/review-queue');
  const [check, setCheck] = useState<any>(null);
  const [code, setCode] = useState('');
  const [maxUses, setMaxUses] = useState(10);
  const [msg, setMsg] = useState('');
  return (
    <>
      <h1>Operations</h1>
      {msg && <p className="err">{msg}</p>}
      <h2>Feature flags</h2>
      <p className="muted">The AI pre-check must stay OFF until the benchmark gate (false-accept, false-reject, abstention, per subgroup) has passed and a human has approved enabling it. It is advisory only and can never reject a person.</p>
      {flags.data?.flags.map((fl) => (
        <div className="card row" key={fl.key}>
          <input type="checkbox" checked={fl.enabled} disabled={!isSuper} onChange={async (e) => setMsg(await act(() => api(`/admin/flags/${fl.key}`, { method: 'PUT', json: { enabled: e.target.checked } }), flags.reload))} />
          <b>{fl.key}</b><span className="muted">{fl.description}</span>
        </div>
      ))}
      <h2>Review queue</h2>
      <div className="card">{queue.data?.open.length ? queue.data.open.map((o) => <div key={o.kind}>{o.kind}: {o.n} open (oldest {new Date(o.oldest).toLocaleString()})</div>) : 'Queue is empty.'}</div>
      <h2>Evidence retention</h2>
      {retention.data && (
        <div className="card">
          Stored objects: {retention.data.stored} · Overdue for deletion: <b className={retention.data.overdue ? 'err' : 'ok'}>{retention.data.overdue}</b>
          <div className="muted">Recent runs: {retention.data.runs.map((r: any) => `${new Date(r.ran_at).toLocaleString()} (${r.deleted_count})`).join(' · ') || 'none'}</div>
          {isSuper && <button className="secondary" onClick={async () => setMsg(await act(() => api('/admin/retention/run', { method: 'POST' }), retention.reload))}>Run retention now</button>}
        </div>
      )}
      {isAud && (
        <>
          <h2>Ledger recomputation check</h2>
          <div className="card">
            <button className="secondary" onClick={async () => setCheck(await api('/admin/ledger-check'))}>Recompute and compare</button>
            {check && <p className={check.ok ? 'ok' : 'err'}>{check.ok ? 'Ledger invariants hold; leaderboard totals match an independent recomputation.' : `Problems: ${JSON.stringify(check)}`}</p>}
          </div>
        </>
      )}
      {isSuper && (
        <>
          <h2>Pilot invitations</h2>
          <div className="card">
            <div className="row">
              <input placeholder="new invite code (6+ chars)" value={code} onChange={(e) => setCode(e.target.value)} />
              <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} style={{ width: 90 }} />
              <button onClick={async () => setMsg(await act(() => api('/admin/invites', { method: 'POST', json: { code, maxUses } }), () => { setCode(''); void invites.reload(); }))}>Create</button>
            </div>
            <table><tbody>{invites.data?.invites.map((i) => (
              <tr key={i.code}><td>{i.code}</td><td>{i.uses}/{i.max_uses}</td><td>{i.active ? 'active' : 'off'}</td>
                <td>{i.active && <button className="secondary" onClick={async () => setMsg(await act(() => api(`/admin/invites/${i.code}/deactivate`, { method: 'POST' }), invites.reload))}>Deactivate</button>}</td></tr>))}</tbody></table>
          </div>
        </>
      )}
      {isAud && (
        <>
          <h2>Audit log</h2>
          <div className="card scroll"><table><thead><tr><th>time</th><th>action</th><th>target</th><th>meta</th></tr></thead>
            <tbody>{audit.data?.entries.map((e) => <tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td><td>{e.action}</td><td>{e.target}</td><td className="muted">{JSON.stringify(e.meta)}</td></tr>)}</tbody></table></div>
        </>
      )}
    </>
  );
}
