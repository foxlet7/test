'use client';
import { useState } from 'react';
import { api, getSession } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

export default function Moderation() {
  const roles = getSession()?.roles ?? [];
  const has = (...r: string[]) => roles.includes('super_admin') || r.some((x) => roles.includes(x));
  const reports = useApi<{ reports: any[] }>(has('moderator', 'translation_reviewer', 'content_admin') ? '/admin/reports' : null);
  const adj = useApi<{ requests: any[] }>(has('moderator', 'auditor') ? '/admin/adjustments' : null);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [ledger, setLedger] = useState<{ id: string; entries: any[] } | null>(null);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ userId: '', eligiblePoints: 0, verifiedPoints: 0, effectiveDate: new Date().toISOString().slice(0, 10), reason: '' });
  return (
    <>
      <h1>Moderation</h1>
      <p className="muted">Never label anyone publicly. Adjustments are new ledger entries with a reason; large ones need a second approver.</p>
      {msg && <p className="err">{msg}</p>}
      {reports.data && (
        <>
          <h2>Content and translation reports</h2>
          {reports.data.reports.filter((r) => r.status === 'open').map((r) => (
            <div className="card row" key={r.id}>
              <span className="tag">{r.kind}</span><span style={{ flex: 1 }}>{r.target} — {r.message}</span>
              <button className="secondary" onClick={async () => setMsg(await act(() => api(`/admin/reports/${r.id}/close`, { method: 'POST' }), reports.reload))}>Close</button>
            </div>
          ))}
          {reports.data.reports.every((r) => r.status !== 'open') && <p>No open reports.</p>}
        </>
      )}
      {has('moderator', 'auditor') && (
        <>
          <h2>Find a user (by nickname prefix)</h2>
          <div className="row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nickname" />
            <button onClick={async () => { try { setUsers((await api<{ users: any[] }>(`/admin/users?pseudonym=${encodeURIComponent(q)}`)).users); } catch { setMsg('Search failed'); } }}>Search</button>
          </div>
          {users.map((u) => (
            <div className="card row" key={u.id}>
              <b>{u.pseudonym}</b><span className="tag">{u.tradition ?? 'none'}</span><span className="tag">{u.status}</span>
              <button className="secondary" onClick={async () => { const r = await api<{ entries: any[] }>(`/admin/users/${u.id}/ledger`); setLedger({ id: u.id, entries: r.entries }); setF({ ...f, userId: u.id }); }}>Ledger</button>
              {has('moderator') && <button className="secondary" onClick={async () => setMsg(await act(() => api(`/admin/users/${u.id}/status`, { method: 'POST', json: { status: u.status === 'active' ? 'suspended' : 'active' } })))}>{u.status === 'active' ? 'Suspend' : 'Reinstate'}</button>}
            </div>
          ))}
          {ledger && (
            <div className="card scroll">
              <table><thead><tr><th>#</th><th>kind</th><th>eligible</th><th>verified</th><th>effective</th><th>reason</th></tr></thead>
                <tbody>{ledger.entries.map((e) => <tr key={e.id}><td>{e.id}</td><td>{e.kind}</td><td>{e.eligible_points}</td><td>{e.verified_points}</td><td>{e.effective_date}</td><td>{e.reason}</td></tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
      {has('moderator') && (
        <div className="card">
          <h2>Manual adjustment</h2>
          <div className="row">
            <label>User ID<input value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} /></label>
            <label>Eligible Δ<input type="number" value={f.eligiblePoints} onChange={(e) => setF({ ...f, eligiblePoints: Number(e.target.value) })} style={{ width: 90 }} /></label>
            <label>Verified Δ<input type="number" value={f.verifiedPoints} onChange={(e) => setF({ ...f, verifiedPoints: Number(e.target.value) })} style={{ width: 90 }} /></label>
            <label>Effective date<input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></label>
          </div>
          <label>Reason (required, audited)<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} style={{ width: '100%' }} /></label>
          <button onClick={async () => setMsg(await act(async () => { const r = await api<{ status: string }>('/admin/adjustments', { method: 'POST', json: f }); setMsg(r.status); }, adj.reload)) }>Submit</button>
        </div>
      )}
      {adj.data && (
        <>
          <h2>Adjustment requests</h2>
          {adj.data.requests.map((r) => (
            <div className="card row" key={r.id}>
              <span className="tag">{r.status}</span><span style={{ flex: 1 }}>Δ eligible {r.eligible_points}, verified {r.verified_points} — {r.reason}</span>
              {r.status === 'pending' && has('moderator') && <>
                <button onClick={async () => setMsg(await act(() => api(`/admin/adjustments/${r.id}/decision`, { method: 'POST', json: { approve: true } }), adj.reload))}>Approve</button>
                <button className="secondary" onClick={async () => setMsg(await act(() => api(`/admin/adjustments/${r.id}/decision`, { method: 'POST', json: { approve: false } }), adj.reload))}>Reject</button>
              </>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
