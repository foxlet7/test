'use client';
import { useState } from 'react';
import { api, getSession } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

export default function Pilot() {
  const metrics = useApi<any>('/admin/pilot/metrics');
  const checklist = useApi<{ items: { key: string; title: string; done: boolean; note: string | null }[] }>('/admin/pilot/checklist');
  const isSuper = getSession()?.roles.includes('super_admin');
  const [msg, setMsg] = useState('');
  const m = metrics.data;
  const done = checklist.data?.items.filter((i) => i.done).length ?? 0;
  const pct = (x: { cohort: number; returned: number }) => (x.cohort ? `${Math.round((100 * x.returned) / x.cohort)}% of ${x.cohort}` : 'n/a');
  return (
    <>
      <h1>Pilot readiness</h1>
      <p className="muted">Counts only — no recordings, notes or religious activity content appear here.</p>
      {m && (
        <div className="grid">
          <div className="card stat"><b>{m.users}</b>users</div>
          <div className="card stat"><b>{m.weeklyActive}</b>weekly active</div>
          <div className="card stat"><b>{m.monthlyActive}</b>monthly active</div>
          <div className="card stat"><b>{m.openReviewTasks}</b>open reviews</div>
          <div className="card stat"><b>{Math.round(m.reviewTurnaroundSeconds / 3600)}h</b>avg review time</div>
          <div className="card stat"><b>{m.appeals.overturned}/{m.appeals.total}</b>appeals overturned</div>
        </div>
      )}
      {m && (
        <div className="card">
          <h2>Retention (returned on or after day N)</h2>
          D1: {pct(m.retention.d1)} · D7: {pct(m.retention.d7)} · D30: {pct(m.retention.d30)}
          <h2>Verification</h2>
          Submissions {m.submissions.total}: verified {m.submissions.verified}, unable {m.submissions.unable}, rejected {m.submissions.rejected}.
          AI pre-check assessed {m.ai.assessed}; AI "match" later overridden {m.ai.overrides}.
          <h2>Privacy operations</h2>
          Deletion requests completed {m.deletion.completed}/{m.deletion.total}; evidence stored {m.evidence.stored}, deleted {m.evidence.deleted}.
        </div>
      )}
      <h2>Go / no-go checklist ({done} of {checklist.data?.items.length ?? 7} complete)</h2>
      <p className="muted">A failure on privacy, religious-content integrity, or ranking correctness blocks expansion.</p>
      {checklist.data?.items.map((i) => (
        <div className="card row" key={i.key}>
          <input type="checkbox" checked={i.done} disabled={!isSuper} onChange={async (e) => {
            setMsg(await act(() => api(`/admin/pilot/checklist/${i.key}`, { method: 'PUT', json: { done: e.target.checked, note: i.note } }), checklist.reload));
          }} />
          <span style={{ flex: 1 }}>{i.title}{i.note ? <span className="muted"> — {i.note}</span> : null}</span>
        </div>
      ))}
      {msg && <p className="err">{msg}</p>}
    </>
  );
}
