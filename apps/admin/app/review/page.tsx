'use client';
import { useState } from 'react';
import { api, audioBlobUrl } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

type Decision = 'verified' | 'unable_to_verify' | 'rejected' | 'under_investigation';

export default function Review() {
  const q = useApi<{ tasks: any[] }>('/review/tasks');
  const [audio, setAudio] = useState<Record<number, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  return (
    <>
      <h1>Verification queue</h1>
      <p className="muted">You see the recording, the task and the rubric — never the person’s identity, rank or other records. “Unable to verify” is not an accusation: use it when the recording is unclear. Judge only the published criteria, never sincerity or faith.</p>
      {msg && <p className="err">{msg}</p>}
      {q.data?.tasks.length === 0 && <p>No open tasks.</p>}
      {q.data?.tasks.map((t) => (
        <div className="card" key={t.id}>
          <div className="row"><b>{t.title_en}</b><span className="tag">{t.tradition}</span><span className="tag">{t.kind}</span>
            {t.risk_flags.map((f: string) => <span key={f} className="tag err">risk: {f}</span>)}</div>
          <div>Passage: <b>{t.passage_ref ?? '—'}</b> · Edition: {t.reference_edition ?? '—'}</div>
          <div className="muted">Permitted variations: {t.permitted_variations ?? '—'}</div>
          {t.ai_result && <div className="muted">Advisory automated pre-check (not a decision): {t.ai_result.result}, confidence {t.ai_result.confidence}</div>}
          <div className="row" style={{ margin: '8px 0' }}>
            {audio[t.id] ? <audio controls src={audio[t.id]} /> : <button className="secondary" onClick={async () => { try { setAudio({ ...audio, [t.id]: await audioBlobUrl(t.id) }); } catch { setMsg('Recording unavailable.'); } }}>Load recording</button>}
          </div>
          {t.rubric.map((r: any, i: number) => (
            <label key={i} style={{ display: 'flex', gap: 8, color: 'inherit' }}>
              <input type="checkbox" checked={!!checks[`${t.id}:${i}`]} onChange={(e) => setChecks({ ...checks, [`${t.id}:${i}`]: e.target.checked })} />
              {r.criterion}{r.required ? ' (required)' : ''}
            </label>
          ))}
          <textarea placeholder="Notes (shown only to staff)" value={notes[t.id] ?? ''} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
          <div className="row">
            {([['verified', 'Meets criteria'], ['unable_to_verify', 'Unable to verify'], ['rejected', 'Does not meet criteria'], ['under_investigation', 'Escalate']] as [Decision, string][]).map(([d, label]) => (
              <button key={d} className={d === 'verified' ? '' : 'secondary'} onClick={async () => {
                const rubric = Object.fromEntries(t.rubric.map((r: any, i: number) => [r.criterion, !!checks[`${t.id}:${i}`]]));
                setMsg(await act(() => api(`/review/tasks/${t.id}/decision`, { method: 'POST', json: { decision: d, rubric, notes: notes[t.id] ?? null } }), q.reload));
              }}>{label}</button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
