import { useState } from 'react';
import { Pager, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface A { id: string; actorId: string | null; actorRole: string | null; action: string; entityType: string; entityId: string | null; meta: unknown; createdAt: string }

export function Audit() {
  const { t, date } = useI18n();
  const [action, setAction] = useState('');
  const l = useList<A>('/admin/audit-logs', { action });
  return (
    <>
      <h1>{t('nav.audit')}</h1>
      <div className="toolbar"><input aria-label={t('col.action')} placeholder={t('col.action')} value={action} onChange={(e) => { setAction(e.target.value.toUpperCase()); l.setPage(1); }} /></div>
      <StateView loading={l.isLoading} error={l.error} empty={l.data?.items.length === 0} onRetry={() => l.refetch()}>
        {l.data && (
          <>
            <Table cols={[
              { header: t('col.when'), cell: (a: A) => date(a.createdAt) },
              { header: t('col.actor'), cell: (a) => `${a.actorRole ?? ''} ${a.actorId?.slice(0, 8) ?? 'system'}` },
              { header: t('col.action'), cell: (a) => a.action },
              { header: t('col.entity'), cell: (a) => `${a.entityType} ${a.entityId?.slice(0, 8) ?? ''}` },
              { header: 'Meta', cell: (a) => (a.meta ? JSON.stringify(a.meta) : ''), wrap: true },
            ]} rows={l.data.items} />
            <Pager page={l.page} pageSize={l.data.pageSize} total={l.data.total} onPage={l.setPage} />
          </>
        )}
      </StateView>
    </>
  );
}
