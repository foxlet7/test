import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Pager, ReasonDialog, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface K { id: string; name: string; city: string; verification: string; createdAt: string; owner: { name: string; email: string | null } }

export function Kitchens() {
  const { t, date } = useI18n();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const l = useList<K>('/admin/kitchens', { status, q });
  return (
    <>
      <h1>{t('nav.kitchens')}</h1>
      <div className="toolbar">
        <input aria-label={t('filter.search')} placeholder={t('filter.search')} value={q} onChange={(e) => { setQ(e.target.value); l.setPage(1); }} />
        <select aria-label={t('filter.status')} value={status} onChange={(e) => { setStatus(e.target.value); l.setPage(1); }}>
          <option value="">{t('filter.all')}</option>
          {['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <StateView loading={l.isLoading} error={l.error} empty={l.data?.items.length === 0} onRetry={() => l.refetch()}>
        {l.data && (
          <>
            <Table cols={[
              { header: t('col.name'), cell: (k: K) => <Link to={`/kitchens/${k.id}`}>{k.name}</Link> },
              { header: t('col.owner'), cell: (k) => `${k.owner.name} ${k.owner.email ?? ''}` },
              { header: t('col.city'), cell: (k) => k.city },
              { header: t('col.status'), cell: (k) => <Badge value={k.verification} /> },
              { header: t('col.created'), cell: (k) => date(k.createdAt) },
            ]} rows={l.data.items} />
            <Pager page={l.page} pageSize={l.data.pageSize} total={l.data.total} onPage={l.setPage} />
          </>
        )}
      </StateView>
    </>
  );
}

interface KD { id: string; name: string; description: string | null; city: string; verification: string; owner: { id: string; name: string; email: string | null; phone: string | null }; verifications: { id: string; status: string; note: string | null; documents: { id: string; type: string }[] }[]; zones: { id: string; name: string; maxKm: number; feeMinor: number }[] }

export function KitchenDetail() {
  const { id } = useParams();
  const { t, money } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['kitchen', id], queryFn: () => api<KD>(`/admin/kitchens/${id}`) });
  const [dlg, setDlg] = useState<null | { decision: string; danger?: boolean; needReason: boolean }>(null);
  const decide = useMutation({
    mutationFn: ({ decision, reason }: { decision: string; reason: string }) => api(`/admin/kitchens/${id}/review`, { method: 'POST', body: { decision, ...(reason ? { reason } : {}) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kitchen', id] }),
  });
  const openDoc = async (docId: string) => {
    // Fetch with the auth header, then show via blob URL (never a public link).
    const s = JSON.parse(sessionStorage.getItem('tablya.admin.session') ?? 'null');
    const r = await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/admin/documents/${docId}`, { headers: { authorization: `Bearer ${s?.accessToken}` } });
    if (r.ok) window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
  };
  const k = q.data;
  const actions: Record<string, { label: string; decision: string; danger?: boolean; needReason: boolean }[]> = {
    SUBMITTED: [{ label: t('act.review'), decision: 'start_review', needReason: false }],
    UNDER_REVIEW: [{ label: t('act.approve'), decision: 'approve', needReason: false }, { label: t('act.reject'), decision: 'reject', danger: true, needReason: true }],
    VERIFIED: [{ label: t('act.suspend'), decision: 'suspend', danger: true, needReason: true }],
    SUSPENDED: [{ label: t('act.reinstate'), decision: 'reinstate', needReason: false }],
  };
  return (
    <>
      <h1>{k?.name ?? t('nav.kitchens')}</h1>
      <StateView loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {k && (
          <>
            <div className="card">
              <dl className="kv">
                <dt>{t('col.status')}</dt><dd><Badge value={k.verification} /></dd>
                <dt>{t('col.owner')}</dt><dd>{k.owner.name} · {k.owner.email} · {k.owner.phone}</dd>
                <dt>{t('col.city')}</dt><dd>{k.city}</dd>
                <dt>—</dt><dd>{k.description}</dd>
                <dt>Zones</dt><dd>{k.zones.map((z) => `${z.name} ≤${z.maxKm}km ${money(z.feeMinor)}`).join(' · ')}</dd>
              </dl>
              {can('ADMIN') && (
                <div className="row-actions" style={{ marginTop: 16 }}>
                  {(actions[k.verification] ?? []).map((a) => (
                    <button key={a.decision} className={`btn ${a.danger ? 'danger' : 'primary'}`} onClick={() => setDlg(a)}>{a.label}</button>
                  ))}
                </div>
              )}
            </div>
            <h2>{t('kitchen.documents')}</h2>
            <p style={{ color: 'var(--muted)' }}>{t('kitchen.docsAudited')}</p>
            <div className="card">
              {k.verifications.flatMap((v) => v.documents.map((d) => (
                <div key={d.id} className="row-actions" style={{ marginBottom: 8 }}>
                  <Badge value={v.status} /> {d.type}
                  {can('ADMIN') && <button className="btn sm" onClick={() => void openDoc(d.id)}>{t('act.viewDoc')}</button>}
                  {v.note && <em>{v.note}</em>}
                </div>
              )))}
            </div>
          </>
        )}
      </StateView>
      {dlg && (
        <ReasonDialog title={`${dlg.decision} — ${k?.name}`} confirmLabel={t('act.confirm')} danger={dlg.danger} needReason={dlg.needReason} onClose={() => setDlg(null)}
          onConfirm={async (reason) => { await decide.mutateAsync({ decision: dlg.decision, reason }); }} />
      )}
    </>
  );
}
