import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Badge, Pager, ReasonDialog, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface Report { id: string; targetType: string; targetId: string; reason: string; details: string | null; createdAt: string; reporter: { name: string } }
interface Review { id: string; rating: number; text: string | null; status: string; customer: { name: string }; kitchen: { name: string } }

const ACTIONS: Record<string, string[]> = {
  REVIEW: ['HIDE_REVIEW'], MENU_ITEM: ['HIDE_ITEM'], KITCHEN: ['SUSPEND_KITCHEN'], USER: ['SUSPEND_USER'], IMAGE: [],
};

export function Moderation() {
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const reports = useList<Report>('/admin/reports');
  const reviews = useList<Review>('/admin/reviews');
  const [dlg, setDlg] = useState<null | { id: string; action: string }>(null);
  const [rev, setRev] = useState<null | Review>(null);
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: string; reason: string }) => api(`/admin/reports/${v.id}/resolve`, { method: 'POST', body: { action: v.action, reason: v.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/admin/reports'] }),
  });
  const vis = useMutation({
    mutationFn: (v: { id: string; visible: boolean; reason: string }) => api(`/admin/reviews/${v.id}/visibility`, { method: 'POST', body: { visible: v.visible, reason: v.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/admin/reviews'] }),
  });
  return (
    <>
      <h1>{t('nav.moderation')}</h1>
      <h2>{t('mod.reports')}</h2>
      <StateView loading={reports.isLoading} error={reports.error} empty={reports.data?.items.length === 0} onRetry={() => reports.refetch()}>
        {reports.data && (
          <>
            <Table cols={[
              { header: t('col.target'), cell: (r: Report) => `${r.targetType} ${r.targetId.slice(0, 8)}` },
              { header: t('col.reason'), cell: (r) => `${r.reason}${r.details ? ` — ${r.details}` : ''}`, wrap: true },
              { header: t('col.customer'), cell: (r) => r.reporter.name },
              { header: t('col.created'), cell: (r) => date(r.createdAt) },
              { header: t('col.actions'), cell: (r) => (
                <div className="row-actions">
                  {(ACTIONS[r.targetType] ?? []).map((a) => <button key={a} className="btn danger sm" onClick={() => setDlg({ id: r.id, action: a })}>{a}</button>)}
                  <button className="btn sm" onClick={() => setDlg({ id: r.id, action: 'DISMISS' })}>{t('act.dismiss')}</button>
                </div>
              ) },
            ]} rows={reports.data.items} />
            <Pager page={reports.page} pageSize={reports.data.pageSize} total={reports.data.total} onPage={reports.setPage} />
          </>
        )}
      </StateView>
      <h2>{t('mod.reviews')}</h2>
      <StateView loading={reviews.isLoading} error={reviews.error} empty={reviews.data?.items.length === 0} onRetry={() => reviews.refetch()}>
        {reviews.data && (
          <Table cols={[
            { header: t('col.kitchen'), cell: (r: Review) => r.kitchen.name },
            { header: t('col.customer'), cell: (r) => r.customer.name },
            { header: t('col.rating'), cell: (r) => '★'.repeat(r.rating) },
            { header: t('col.text'), cell: (r) => r.text ?? '', wrap: true },
            { header: t('col.status'), cell: (r) => <Badge value={r.status} /> },
            { header: t('col.actions'), cell: (r) => <button className="btn sm" onClick={() => setRev(r)}>{r.status === 'VISIBLE' ? t('act.hide') : t('act.show')}</button> },
          ]} rows={reviews.data.items} />
        )}
      </StateView>
      {dlg && <ReasonDialog title={dlg.action} confirmLabel={t('act.confirm')} danger={dlg.action !== 'DISMISS'} onClose={() => setDlg(null)} onConfirm={async (reason) => { await resolve.mutateAsync({ ...dlg, reason }); }} />}
      {rev && <ReasonDialog title={rev.status === 'VISIBLE' ? t('act.hide') : t('act.show')} confirmLabel={t('act.confirm')} onClose={() => setRev(null)} onConfirm={async (reason) => { await vis.mutateAsync({ id: rev.id, visible: rev.status !== 'VISIBLE', reason }); }} />}
    </>
  );
}
