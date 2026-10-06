import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { StateView, Badge } from '../components/ui';
import { useI18n } from '../i18n';

interface Dash {
  users: number; activeCustomers30d: number; activeKitchens: number; pendingVerification: number; orders30d: number;
  ordersByStatus: Record<string, number>; gmv30dMinor: number; platformRevenue30dMinor: number; refunds30d: { count: number; amountMinor: number };
  openReports: number; openTickets: number; rating: { avg: number; count: number }; pendingRefunds: number; system: { database: string; webhookProblems7d: number };
}
interface Daily { daily: { day: string; orders: number; gmvMinor: number }[] }

export function Dashboard() {
  const { t, money } = useI18n();
  const d = useQuery({ queryKey: ['dash'], queryFn: () => api<Dash>('/admin/dashboard'), refetchInterval: 30_000 });
  const a = useQuery({ queryKey: ['daily'], queryFn: () => api<Daily>('/admin/analytics/daily?days=14'), retry: false });
  const stat = (label: string, value: string | number) => (
    <div className="card stat" key={label}><div className="label">{label}</div><div className="value">{value}</div></div>
  );
  const max = Math.max(1, ...(a.data?.daily.map((x) => x.orders) ?? [1]));
  return (
    <>
      <h1>{t('nav.dashboard')}</h1>
      <StateView loading={d.isLoading} error={d.error} onRetry={() => d.refetch()}>
        {d.data && (
          <>
            <div className="grid">
              {stat(t('dash.users'), d.data.users)}
              {stat(t('dash.customers'), d.data.activeCustomers30d)}
              {stat(t('dash.kitchens'), d.data.activeKitchens)}
              {stat(t('dash.pending'), d.data.pendingVerification)}
              {stat(t('dash.orders'), d.data.orders30d)}
              {stat(t('dash.gmv'), money(d.data.gmv30dMinor))}
              {stat(t('dash.revenue'), money(d.data.platformRevenue30dMinor))}
              {stat(`${t('dash.refunds')} (${d.data.refunds30d.count})`, money(d.data.refunds30d.amountMinor))}
              {stat(t('dash.reports'), d.data.openReports)}
              {stat(t('dash.tickets'), d.data.openTickets)}
              {stat(t('dash.rating'), `${d.data.rating.avg.toFixed(2)} (${d.data.rating.count})`)}
              {stat(t('dash.pendingRefunds'), d.data.pendingRefunds)}
            </div>
            <h2>{t('dash.byStatus')}</h2>
            <div className="card row-actions">
              {Object.entries(d.data.ordersByStatus).map(([s, n]) => <span key={s}><Badge value={s} /> {n}</span>)}
            </div>
            <h2>{t('dash.daily')}</h2>
            <div className="card">
              {a.data ? (
                <div className="bars" role="img" aria-label={t('dash.daily')}>
                  {a.data.daily.slice(-14).map((x) => <div key={x.day} title={`${x.day.slice(0, 10)}: ${x.orders}`} style={{ height: `${(x.orders / max) * 100}%` }} />)}
                </div>
              ) : <span className="state">{a.isLoading ? t('state.loading') : t('state.empty')}</span>}
            </div>
            <h2>{t('dash.system')}</h2>
            <div className="card">
              <dl className="kv">
                <dt>{t('dash.db')}</dt><dd><Badge value={d.data.system.database} /></dd>
                <dt>{t('dash.webhooks')}</dt><dd><Badge value={d.data.system.webhookProblems7d === 0 ? 'ok' : 'down'} /> {d.data.system.webhookProblems7d}</dd>
              </dl>
            </div>
          </>
        )}
      </StateView>
    </>
  );
}
