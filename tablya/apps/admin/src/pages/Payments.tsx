import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Pager, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface P { id: string; status: string; provider: string; method: string; amountMinor: number; currency: string; createdAt: string; failureReason: string | null; order: { orderNo: number } }
interface R { id: string; status: string; amountMinor: number; reason: string; createdAt: string }
interface W { id: string; type: string; signatureValid: boolean; processedAt: string | null; error: string | null; receivedAt: string }

export function Payments() {
  const { t, money, date } = useI18n();
  const pay = useList<P>('/admin/payments');
  const ref = useList<R>('/admin/refunds');
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api<W[]>('/admin/webhooks?problemsOnly=true') });
  return (
    <>
      <h1>{t('nav.payments')}</h1>
      <StateView loading={pay.isLoading} error={pay.error} empty={pay.data?.items.length === 0} onRetry={() => pay.refetch()}>
        {pay.data && (
          <>
            <Table cols={[
              { header: t('col.order'), cell: (p: P) => `#${p.order.orderNo}` },
              { header: t('col.payment'), cell: (p) => `${p.provider} / ${p.method}` },
              { header: t('col.status'), cell: (p) => <><Badge value={p.status} /> {p.failureReason}</> },
              { header: t('col.amount'), cell: (p) => money(p.amountMinor, p.currency) },
              { header: t('col.created'), cell: (p) => date(p.createdAt) },
            ]} rows={pay.data.items} />
            <Pager page={pay.page} pageSize={pay.data.pageSize} total={pay.data.total} onPage={pay.setPage} />
          </>
        )}
      </StateView>
      <h2>{t('order.refunds')}</h2>
      <StateView loading={ref.isLoading} error={ref.error} empty={ref.data?.items.length === 0} onRetry={() => ref.refetch()}>
        {ref.data && <Table cols={[
          { header: t('col.status'), cell: (r: R) => <Badge value={r.status} /> },
          { header: t('col.amount'), cell: (r) => money(r.amountMinor) },
          { header: t('col.reason'), cell: (r) => r.reason, wrap: true },
          { header: t('col.created'), cell: (r) => date(r.createdAt) },
        ]} rows={ref.data.items} />}
      </StateView>
      <h2>{t('dash.webhooks')}</h2>
      <StateView loading={hooks.isLoading} error={hooks.error} empty={hooks.data?.length === 0} onRetry={() => hooks.refetch()}>
        {hooks.data && <Table cols={[
          { header: t('col.entity'), cell: (w: W) => w.type },
          { header: 'Signature', cell: (w) => <Badge value={w.signatureValid ? 'ok' : 'down'} /> },
          { header: 'Error', cell: (w) => w.error ?? (w.processedAt ? '' : 'unprocessed'), wrap: true },
          { header: t('col.when'), cell: (w) => date(w.receivedAt) },
        ]} rows={hooks.data} />}
      </StateView>
    </>
  );
}
