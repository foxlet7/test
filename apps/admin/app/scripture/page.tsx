'use client';
import { useState } from 'react';
import { api, getSession } from '@/lib/api';
import { act, useApi } from '@/lib/hooks';

export default function Scripture() {
  const list = useApi<{ tasks: any[] }>('/admin/scripture-tasks');
  const content = useApi<{ versions: any[] }>('/admin/content');
  const roles = getSession()?.roles ?? [];
  const has = (...r: string[]) => roles.includes('super_admin') || r.some((x) => roles.includes(x));
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ id: '', activityId: '', titleEn: '', titleAr: '', passageRef: '', referenceEdition: '', permittedVariations: '', rubric: '' });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const milestoneActivities = Array.from(new Set(content.data?.versions.filter((v) => v.verification_class === 'B').map((v) => v.activity_id)));
  return (
    <>
      <h1>Scripture verification tasks</h1>
      <p className="muted">Qualified reviewers define the passage, accepted edition/translation, permitted variations and rubric. Nothing here is hard-coded by developers, and verification only checks the published criteria — never faith or tajwid unless the rubric explicitly says so.</p>
      {msg && <p className="err">{msg}</p>}
      {list.data?.tasks.map((t) => (
        <div className="card" key={t.id}>
          <div className="row"><b>{t.title_en}</b><span className={`tag ${t.status}`}>{t.status}</span><span className="muted">{t.id} · {t.activity_id}</span></div>
          <div>Passage: {t.passage_ref ?? <i>not set</i>} · Edition: {t.reference_edition ?? <i>not set</i>}</div>
          <div className="muted">Variations: {t.permitted_variations ?? '—'} · Rubric items: {t.rubric.length}</div>
          {t.status !== 'approved' && has('islamic_reviewer', 'christian_reviewer') && <button onClick={async () => setMsg(await act(() => api(`/admin/scripture-tasks/${t.id}/approve`, { method: 'POST' }), list.reload))}>Approve task</button>}
        </div>
      ))}
      {has('content_admin') && (
        <div className="card">
          <h2>Create or update a task (returns to draft)</h2>
          <div className="row">
            <label>Task ID<input value={f.id} onChange={(e) => set('id', e.target.value)} /></label>
            <label>Activity<select value={f.activityId} onChange={(e) => set('activityId', e.target.value)}><option value="">choose…</option>{milestoneActivities.map((a) => <option key={a}>{a}</option>)}</select></label>
          </div>
          <label>Title (EN)<input value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} style={{ width: '100%' }} /></label>
          <label>Title (AR)<input dir="rtl" value={f.titleAr} onChange={(e) => set('titleAr', e.target.value)} style={{ width: '100%' }} /></label>
          <label>Passage reference<input value={f.passageRef} onChange={(e) => set('passageRef', e.target.value)} style={{ width: '100%' }} /></label>
          <label>Reference edition / translation<input value={f.referenceEdition} onChange={(e) => set('referenceEdition', e.target.value)} style={{ width: '100%' }} /></label>
          <label>Permitted variations<textarea value={f.permittedVariations} onChange={(e) => set('permittedVariations', e.target.value)} /></label>
          <label>Rubric (one criterion per line)<textarea value={f.rubric} onChange={(e) => set('rubric', e.target.value)} /></label>
          <button onClick={async () => setMsg(await act(() => api(`/admin/scripture-tasks/${f.id}`, { method: 'PUT', json: { activityId: f.activityId, titleEn: f.titleEn, titleAr: f.titleAr, passageRef: f.passageRef || null, referenceEdition: f.referenceEdition || null, permittedVariations: f.permittedVariations || null, rubric: f.rubric.split('\n').map((s) => s.trim()).filter(Boolean).map((criterion) => ({ criterion, required: true })) } }), list.reload))}>Save draft</button>
        </div>
      )}
    </>
  );
}
