import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { allowedNext, ORDER_STATUSES, type OrderStatus } from '@tablya/shared';
import { api, newKey } from '../api';
import { useAuth } from '../auth';
import { Badge, Pager, ReasonDialog, StateView, Table } from '../components/ui';
import { useList } from '../components/useList';
import { useI18n } from '../i18n';

interface O { id: string; orderNo: number; status: string; totalMinor: number; currency: string; paymentMethod: string; createdAt: string; kitchen: string; customer: string }

export function Orders() {
  const { t, money, date } = useI18n();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const l = useList<O>('/admin/orders', { status, q });
  return (
    <>
      <h1>{t('nav.orders')}</h1>
      <div className="toolbar">
        <input aria-label={t('col.order')} placeholder="#" inputMode="numeric" value={q} onChange={(e) => { setQ(e.target.value.replace(/\D/g, '')); l.setPage(1); }} />
        <select aria-label={t('filter.status')} value={status} onChange={(e) => { setStatus(e.target.value); l.setPage(1); }}>
          <option value="">{t('filter.all')}</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`order.status.${s}`)}</option>)}
        </select>
      </div>
      <StateView loading={l.isLoading} error={l.error} empty={l.data?.items.length === 0} onRetry={() => l.refetch()}>
        {l.data && (
          <>
            <Table cols={[
              { header: t('col.order'), cell: (o: O) => <Link to={`/orders/${o.id}`}>#{o.orderNo}</Link> },
              { header: t('col.kitchen'), cell: (o) => o.kitchen },
              { header: t('col.customer'), cell: (o) => o.customer },
              { header: t('col.status'), cell: (o) => <Badge value={o.status} /> },
              { header: t('col.payment'), cell: (o) => o.paymentMethod },
              { header: t('col.total'), cell: (o) => money(o.totalMinor, o.currency) },
              { header: t('col.created'), cell: (o) => date(o.createdAt) },
            ]} rows={l.data.items} />
            <Pager page={l.page} pageSize={l.data.pageSize} total={l.data.total} onPage={l.setPage} />
          </>
        )}
      </StateView>
    </>
  );
}

interface OD {
  id: string; orderNo: number; status: string; paymentMethod: string; totalMinor: number; currency: string; subtotalMinor: number; taxMinor: number; deliveryFeeMinor: number; discountMinor: number;
  items: { id: string; name: string; quantity: number; lineTotalMinor: number }[];
  history: { id: string; fromStatus: string | null; toStatus: string; actorType: string; reason: string | null; createdAt: string }[];
  payments: { id: string; status: string; provider: string; amountMinor: number }[];
  refunds: { id: string; status: string; amountMinor: number; reason: string }[];
  ledger: { id: string; account: string; amountMinor: number; ref: string }[];
  customer: { name: string; email: string | null }; kitchen: { name: string };
}

export function OrderDetail() {
  const { id } = useParams();
  const { t, money, date } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<OD>(`/admin/orders/${id}`) });
  const [dlg, setDlg] = useState<null | { kind: 'refund' } | { kind: 'move'; to: OrderStatus }>(null);
  const [refundKey] = useState(newKey); // one idempotency key per dialog session: double clicks can't double refund
  const [amount, setAmount] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['order', id] });
  const move = useMutation({ mutationFn: (v: { to: string; reason: string }) => api(`/admin/orders/${id}/transition`, { method: 'POST', body: v }), onSuccess: refresh });
  const refund = useMutation({
    mutationFn: (v: { reason: string }) => api(`/admin/orders/${id}/refund`, { method: 'POST', headers: { 'Idempotency-Key': refundKey }, body: { reason: v.reason, ...(amount ? { amountMinor: Math.round(parseFloat(amount) * 100) } : {}) } }),
    onSuccess: refresh,
  });
  const o = q.data;
  const nextOptions = o ? allowedNext(o.status as OrderStatus, 'ADMIN').filter((s) => s !== 'REFUND_PENDING' && s !== 'REFUNDED') : [];
  return (
    <>
      <h1>#{o?.orderNo}</h1>
      <StateView loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {o && (
          <>
            <div className="card">
              <dl className="kv">
                <dt>{t('col.status')}</dt><dd><Badge value={o.status} /></dd>
                <dt>{t('col.customer')}</dt><dd>{o.customer.name} {o.customer.email}</dd>
                <dt>{t('col.kitchen')}</dt><dd>{o.kitchen.name}</dd>
                <dt>{t('col.payment')}</dt><dd>{o.paymentMethod}</dd>
                <dt>{t('col.total')}</dt><dd>{money(o.totalMinor, o.currency)} ({money(o.subtotalMinor)} + {money(o.deliveryFeeMinor)} + {money(o.taxMinor)} − {money(o.discountMinor)})</dd>
              </dl>
              {can('ADMIN', 'SUPPORT') && (
                <div className="row-actions" style={{ marginTop: 16 }}>
                  {nextOptions.map((s) => <button key={s} className="btn sm" onClick={() => setDlg({ kind: 'move', to: s })}>{t('act.override')} {t(`order.status.${s}`)}</button>)}
                  {can('ADMIN') && o.paymentMethod === 'CARD' && <button className="btn danger sm" onClick={() => setDlg({ kind: 'refund' })}>{t('act.refund')}</button>}
                </div>
              )}
            </div>
            <h2>{t('order.items')}</h2>
            <Table cols={[{ header: t('col.name'), cell: (i: OD['items'][number]) => `${i.quantity}× ${i.name}` }, { header: t('col.amount'), cell: (i) => money(i.lineTotalMinor) }]} rows={o.items} />
            <h2>{t('order.history')}</h2>
            <Table cols={[
              { header: t('col.when'), cell: (h: OD['history'][number]) => date(h.createdAt) },
              { header: t('col.status'), cell: (h) => `${h.fromStatus ?? '∅'} → ${h.toStatus}` },
              { header: t('col.actor'), cell: (h) => h.actorType },
              { header: t('col.reason'), cell: (h) => h.reason ?? '', wrap: true },
            ]} rows={o.history} />
            <h2>{t('order.payments')} / {t('order.refunds')}</h2>
            <Table cols={[{ header: 'ID', cell: (p: { id: string; status: string; amountMinor: number }) => p.id.slice(0, 8) }, { header: t('col.status'), cell: (p) => <Badge value={p.status} /> }, { header: t('col.amount'), cell: (p) => money(p.amountMinor) }]} rows={[...o.payments, ...o.refunds]} />
            <h2>{t('order.ledger')}</h2>
            <Table cols={[{ header: t('col.entity'), cell: (e: OD['ledger'][number]) => e.account }, { header: t('col.amount'), cell: (e) => money(e.amountMinor) }, { header: 'Ref', cell: (e) => e.ref, wrap: true }]} rows={o.ledger} />
          </>
        )}
      </StateView>
      {dlg?.kind === 'move' && <ReasonDialog title={`${t('act.override')} ${t(`order.status.${dlg.to}`)}`} confirmLabel={t('act.confirm')} onClose={() => setDlg(null)} onConfirm={async (reason) => { await move.mutateAsync({ to: dlg.to, reason }); }} />}
      {dlg?.kind === 'refund' && (
        <ReasonDialog title={t('act.refund')} confirmLabel={t('act.refund')} danger onClose={() => setDlg(null)} onConfirm={async (reason) => { await refund.mutateAsync({ reason }); }}
          extra={<div className="field"><label htmlFor="amt">{t('col.amount')} (blank = full)</label><input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></div>} />
      )}
    </>
  );
}
