'use client';
import { useState } from 'react';
import { api, getSession } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

const blank = {
  id: '', tradition: 'islam', category: 'character', type: 'recurring', obligationClass: 'general_good_deed', verificationClass: 'A',
  basePoints: 5, repeatKind: 'per_day', repeatMax: 1, titleEn: '', titleAr: '', descriptionEn: '', descriptionAr: '', notesEn: '', notesAr: '',
};

export default function Content() {
  const list = useApi<{ versions: any[] }>('/admin/content');
  const roles = getSession()?.roles ?? [];
  const has = (...r: string[]) => roles.includes('super_admin') || r.some((x) => roles.includes(x));
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('all');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const set = (k: keyof typeof blank, v: string | number) => setF({ ...f, [k]: v });
  const run = async (fn: () => Promise<unknown>) => setMsg(await act(fn, list.reload));
  const repeat = f.repeatKind === 'per_milestone' ? { kind: 'per_milestone' } : { kind: f.repeatKind, max: Number(f.repeatMax) };

  return (
    <>
      <h1>Content governance</h1>
      <p className="muted">Activities move draft → in review → approved. Approval needs a reviewed translation and a qualified reviewer who is not the author. Points are illustrative app values, not religious valuations.</p>
      <div className="row">
        {['all', 'draft', 'in_review', 'approved', 'retired'].map((s) => <button key={s} className={filter === s ? '' : 'secondary'} onClick={() => setFilter(s)}>{s}</button>)}
      </div>
      {msg && <p className="err">{msg}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Activity</th><th>v</th><th>Status</th><th>Pts / repeat</th><th>Translation</th><th>Actions</th></tr></thead>
          <tbody>
            {list.data?.versions.filter((v) => filter === 'all' || v.status === filter).map((v) => (
              <tr key={v.version_id}>
                <td><b>{v.title_en}</b><br /><span className="muted">{v.activity_id} · {v.tradition} · {v.obligation_class}</span><br /><span dir="rtl">{v.title_ar}</span></td>
                <td>{v.version}</td>
                <td><span className={`tag ${v.status}`}>{v.status}</span></td>
                <td>{v.base_points} · {v.repeat_policy.kind}{v.repeat_policy.max ? ` ×${v.repeat_policy.max}` : ''}</td>
                <td>{v.translation_status}</td>
                <td>
                  <div className="row">
                    {v.status === 'draft' && has('content_admin') && <button onClick={() => run(() => api(`/admin/content/versions/${v.version_id}/submit`, { method: 'POST' }))}>Submit</button>}
                    {v.translation_status !== 'reviewed' && v.status !== 'approved' && v.status !== 'retired' && has('translation_reviewer') && <button className="secondary" onClick={() => run(() => api(`/admin/content/versions/${v.version_id}/translation-review`, { method: 'POST' }))}>Translation OK</button>}
                  </div>
                  {v.status === 'in_review' && has('islamic_reviewer', 'christian_reviewer') && (
                    <div style={{ marginTop: 6 }}>
                      <input placeholder="reviewer notes" value={notes[v.version_id] ?? ''} onChange={(e) => setNotes({ ...notes, [v.version_id]: e.target.value })} />
                      <div className="row" style={{ marginTop: 4 }}>
                        <button onClick={() => run(() => api(`/admin/content/versions/${v.version_id}/review`, { method: 'POST', json: { decision: 'approve', notes: notes[v.version_id] ?? null } }))}>Approve</button>
                        <button className="secondary" onClick={() => run(() => api(`/admin/content/versions/${v.version_id}/review`, { method: 'POST', json: { decision: 'request_changes', notes: notes[v.version_id] ?? null } }))}>Request changes</button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {has('content_admin') && (
        <>
          <h2>New activity (creates a draft)</h2>
          <div className="card">
            <div className="row">
              <label>ID<input value={f.id} placeholder="islam.service.example" onChange={(e) => set('id', e.target.value)} /></label>
              <label>Tradition<select value={f.tradition} onChange={(e) => set('tradition', e.target.value)}><option>islam</option><option>christianity</option></select></label>
              <label>Category<select value={f.category} onChange={(e) => set('category', e.target.value)}>{['worship', 'learning', 'charity', 'character', 'service'].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Type<select value={f.type} onChange={(e) => set('type', e.target.value)}>{['recurring', 'milestone', 'event', 'measurable'].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Obligation<select value={f.obligationClass} onChange={(e) => set('obligationClass', e.target.value)}>{['obligatory', 'voluntary', 'general_good_deed'].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Verification<select value={f.verificationClass} onChange={(e) => set('verificationClass', e.target.value)}>{['A', 'B', 'C'].map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
            <div className="row">
              <label>Base points<input type="number" min={0} max={100} value={f.basePoints} onChange={(e) => set('basePoints', Number(e.target.value))} style={{ width: 90 }} /></label>
              <label>Repeat<select value={f.repeatKind} onChange={(e) => set('repeatKind', e.target.value)}><option value="per_day">per day</option><option value="per_week">per week</option><option value="per_milestone">once per milestone</option></select></label>
              {f.repeatKind !== 'per_milestone' && <label>Max<input type="number" min={1} value={f.repeatMax} onChange={(e) => set('repeatMax', Number(e.target.value))} style={{ width: 80 }} /></label>}
            </div>
            <label>Title (English)<input value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} style={{ width: '100%' }} /></label>
            <label>Title (Arabic)<input dir="rtl" value={f.titleAr} onChange={(e) => set('titleAr', e.target.value)} style={{ width: '100%' }} /></label>
            <label>Description (English)<textarea value={f.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} /></label>
            <label>Description (Arabic)<textarea dir="rtl" value={f.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} /></label>
            <label>Tradition-specific note (English)<textarea value={f.notesEn} onChange={(e) => set('notesEn', e.target.value)} /></label>
            <label>Tradition-specific note (Arabic)<textarea dir="rtl" value={f.notesAr} onChange={(e) => set('notesAr', e.target.value)} /></label>
            <button onClick={() => run(async () => {
              await api('/admin/content', { method: 'POST', json: { id: f.id, tradition: f.tradition, category: f.category, type: f.type, obligationClass: f.obligationClass, verificationClass: f.verificationClass, basePoints: f.basePoints, repeatPolicy: repeat, titleEn: f.titleEn, titleAr: f.titleAr, descriptionEn: f.descriptionEn, descriptionAr: f.descriptionAr, notesEn: f.notesEn || null, notesAr: f.notesAr || null, religiousReferences: [] } });
              setF(blank);
            })}>Create draft</button>
          </div>
        </>
      )}
    </>
  );
}
