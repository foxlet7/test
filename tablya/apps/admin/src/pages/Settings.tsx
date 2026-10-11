import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ReasonDialog, StateView } from '../components/ui';
import { useI18n } from '../i18n';

interface S { currency: string; taxBps: number; serviceFeeBps: number; defaultCommissionBps: number }

export function Settings() {
  const { t } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<S>('/admin/settings') });
  const [f, setF] = useState({ taxBps: '0', serviceFeeBps: '0', defaultCommissionBps: '0' });
  const [open, setOpen] = useState(false);
  useEffect(() => { if (q.data) setF({ taxBps: String(q.data.taxBps), serviceFeeBps: String(q.data.serviceFeeBps), defaultCommissionBps: String(q.data.defaultCommissionBps) }); }, [q.data]);
  const save = useMutation({
    mutationFn: (reason: string) => api('/admin/settings', { method: 'PUT', body: { taxBps: +f.taxBps, serviceFeeBps: +f.serviceFeeBps, defaultCommissionBps: +f.defaultCommissionBps, reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const isSuper = roles.includes('SUPER_ADMIN');
  const field = (k: keyof typeof f, label: string) => (
    <div className="field"><label htmlFor={k}>{label}</label><input id={k} inputMode="numeric" disabled={!isSuper} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') })} /> <small>{(+f[k] / 100).toFixed(2)}%</small></div>
  );
  return (
    <>
      <h1>{t('nav.settings')}</h1>
      <StateView loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        <div className="card">
          {!isSuper && <p style={{ color: 'var(--muted)' }}>{t('settings.superOnly')}</p>}
          {field('taxBps', t('settings.tax'))}{field('serviceFeeBps', t('settings.service'))}{field('defaultCommissionBps', t('settings.commission'))}
          {isSuper && <button className="btn primary" onClick={() => setOpen(true)}>{t('act.save')}</button>}
        </div>
      </StateView>
      {open && <ReasonDialog title={t('nav.settings')} confirmLabel={t('act.save')} onClose={() => setOpen(false)} onConfirm={async (r) => { await save.mutateAsync(r); }} />}
    </>
  );
}
