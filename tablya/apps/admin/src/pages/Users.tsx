import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Pager, ReasonDialog, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface U { id: string; name: string; email: string | null; roles: string[]; status: string; createdAt: string }

export function Users() {
  const { t, date } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dlg, setDlg] = useState<null | { u: U; action: 'suspend' | 'reinstate' }>(null);
  const l = useList<U>('/admin/users', { q, status });
  const act = useMutation({ mutationFn: (v: { id: string; action: string; reason: string }) => api(`/admin/users/${v.id}/${v.action}`, { method: 'POST', body: { reason: v.reason } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['/admin/users'] }) });
  return (
    <>
      <h1>{t('nav.users')}</h1>
      <div className="toolbar">
        <input aria-label={t('filter.search')} placeholder={t('filter.search')} value={q} onChange={(e) => { setQ(e.target.value); l.setPage(1); }} />
        <select aria-label={t('filter.status')} value={status} onChange={(e) => { setStatus(e.target.value); l.setPage(1); }}>
          <option value="">{t('filter.all')}</option>{['ACTIVE', 'SUSPENDED', 'DELETED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <StateView loading={l.isLoading} error={l.error} empty={l.data?.items.length === 0} onRetry={() => l.refetch()}>
        {l.data && (
          <>
            <Table cols={[
              { header: t('col.name'), cell: (u: U) => u.name },
              { header: t('col.email'), cell: (u) => u.email ?? '—' },
              { header: t('col.roles'), cell: (u) => u.roles.join(', ') },
              { header: t('col.status'), cell: (u) => <Badge value={u.status} /> },
              { header: t('col.created'), cell: (u) => date(u.createdAt) },
              { header: t('col.actions'), cell: (u) => can('ADMIN') && u.status === 'ACTIVE' ? <button className="btn danger sm" onClick={() => setDlg({ u, action: 'suspend' })}>{t('act.suspend')}</button> : can('ADMIN') && u.status === 'SUSPENDED' ? <button className="btn sm" onClick={() => setDlg({ u, action: 'reinstate' })}>{t('act.reinstate')}</button> : null },
            ]} rows={l.data.items} />
            <Pager page={l.page} pageSize={l.data.pageSize} total={l.data.total} onPage={l.setPage} />
          </>
        )}
      </StateView>
      {dlg && <ReasonDialog title={`${t(`act.${dlg.action}`)} — ${dlg.u.name}`} confirmLabel={t('act.confirm')} danger={dlg.action === 'suspend'} onClose={() => setDlg(null)} onConfirm={async (reason) => { await act.mutateAsync({ id: dlg.u.id, action: dlg.action, reason }); }} />}
    </>
  );
}
