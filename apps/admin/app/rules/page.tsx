'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

export default function Rules() {
  const list = useApi<{ rules: any[] }>('/admin/scoring-rules');
  const latest = list.data?.rules[0];
  const [f, setF] = useState({ lateVerificationWindowDays: 14, maxBackdateDays: 2, adjustmentApprovalThreshold: 20, effectiveFrom: new Date().toISOString().slice(0, 10), note: '' });
  const [msg, setMsg] = useState('');
  return (
    <>
      <h1>Scoring rules</h1>
      <p className="muted">Rule versions are never edited. A new version applies from its effective date; every past award keeps the version it was made under. Per-activity point values and repeat limits live in the content catalogue.</p>
      <div className="card scroll">
        <table><thead><tr><th>v</th><th>effective</th><th>late-verification window</th><th>max backdate</th><th>approval threshold</th><th>note</th></tr></thead>
          <tbody>{list.data?.rules.map((r) => <tr key={r.version}><td>{r.version}</td><td>{r.effective_from}</td><td>{r.config.lateVerificationWindowDays} d</td><td>{r.config.maxBackdateDays} d</td><td>{r.config.adjustmentApprovalThreshold}</td><td>{r.note}</td></tr>)}</tbody></table>
      </div>
      <div className="card">
        <h2>Create next version</h2>
        {latest && <p className="muted">Diff vs v{latest.version}: window {latest.config.lateVerificationWindowDays}→{f.lateVerificationWindowDays}, backdate {latest.config.maxBackdateDays}→{f.maxBackdateDays}, threshold {latest.config.adjustmentApprovalThreshold}→{f.adjustmentApprovalThreshold}</p>}
        <div className="row">
          <label>Late-verification window (days)<input type="number" min={0} max={90} value={f.lateVerificationWindowDays} onChange={(e) => setF({ ...f, lateVerificationWindowDays: Number(e.target.value) })} /></label>
          <label>Max backdate (days)<input type="number" min={0} max={7} value={f.maxBackdateDays} onChange={(e) => setF({ ...f, maxBackdateDays: Number(e.target.value) })} /></label>
          <label>Second-approver threshold<input type="number" min={1} value={f.adjustmentApprovalThreshold} onChange={(e) => setF({ ...f, adjustmentApprovalThreshold: Number(e.target.value) })} /></label>
          <label>Effective from<input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></label>
        </div>
        <label>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ width: '100%' }} /></label>
        <button onClick={async () => setMsg(await act(() => api('/admin/scoring-rules', { method: 'POST', json: { ...f, note: f.note || undefined } }), list.reload))}>Publish version</button>
        {msg && <p className="err">{msg}</p>}
      </div>
    </>
  );
}
