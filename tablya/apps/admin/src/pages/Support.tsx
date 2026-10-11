import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Badge, Pager, ReasonDialog, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface T { id: string; subject: string; status: string; updatedAt: string; user: { name: string }; messages: { id: string; body: string; authorId: string }[] }

export function Support() {
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const l = useList<T>('/admin/support/tickets');
  const [ticket, setTicket] = useState<T | null>(null);
  const reply = useMutation({
    mutationFn: (v: { id: string; body: string }) => api(`/admin/support/tickets/${v.id}/reply`, { method: 'POST', body: { body: v.body, status: 'PENDING' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/admin/support/tickets'] }),
  });
  return (
    <>
      <h1>{t('nav.support')}</h1>
      <StateView loading={l.isLoading} error={l.error} empty={l.data?.items.length === 0} onRetry={() => l.refetch()}>
        {l.data && (
          <>
            <Table cols={[
              { header: t('col.subject'), cell: (x: T) => <><strong>{x.subject}</strong><div style={{ color: 'var(--muted)' }}>{x.messages[x.messages.length - 1]?.body.slice(0, 120)}</div></>, wrap: true },
              { header: t('col.customer'), cell: (x) => x.user.name },
              { header: t('col.status'), cell: (x) => <Badge value={x.status} /> },
              { header: t('col.when'), cell: (x) => date(x.updatedAt) },
              { header: t('col.actions'), cell: (x) => <button className="btn sm" onClick={() => setTicket(x)}>{t('act.reply')}</button> },
            ]} rows={l.data.items} />
            <Pager page={l.page} pageSize={l.data.pageSize} total={l.data.total} onPage={l.setPage} />
          </>
        )}
      </StateView>
      {ticket && <ReasonDialog title={`${t('support.reply')}: ${ticket.subject}`} confirmLabel={t('act.reply')} onClose={() => setTicket(null)} onConfirm={async (body) => { await reply.mutateAsync({ id: ticket.id, body }); }} />}
    </>
  );
}
