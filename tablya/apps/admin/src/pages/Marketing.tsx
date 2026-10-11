import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Badge, StateView, Table, useToast, errMsg } from '../components/ui';
import { useI18n } from '../i18n';

interface C {
  id: string;
  code: string;
  type: string;
  value: number;
  usedCount: number;
  usageLimit: number | null;
  active: boolean;
}

export function Marketing() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['coupons'], queryFn: () => api<C[]>('/admin/coupons') });
  const [form, setForm] = useState({ code: '', type: 'PERCENT', value: '10', usageLimit: '' });
  const create = useMutation({
    mutationFn: () =>
      api('/admin/coupons', {
        method: 'POST',
        body: {
          code: form.code.toUpperCase(),
          type: form.type,
          value: parseInt(form.value, 10) * (form.type === 'FIXED' ? 100 : 1),
          ...(form.usageLimit ? { usageLimit: parseInt(form.usageLimit, 10) } : {}),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coupons'] });
      setForm({ ...form, code: '' });
      toast(t('toast.done'));
    },
    onError: (e) => toast(errMsg(e, t('toast.failed')), 'bad'),
  });
  const toggle = useMutation({
    mutationFn: (c: C) =>
      api(`/admin/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
    onError: (e) => toast(errMsg(e, t('toast.failed')), 'bad'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <>
      <h1>{t('nav.marketing')}</h1>
      <form className="card toolbar" onSubmit={submit}>
        <input
          aria-label={t('col.code')}
          placeholder={t('col.code')}
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          pattern="[A-Za-z0-9_-]{3,30}"
          required
        />
        <select
          aria-label={t('coupon.type')}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="PERCENT">{t('coupon.percent')}</option>
          <option value="FIXED">{t('coupon.fixed')}</option>
        </select>
        <input
          aria-label={t('col.value')}
          inputMode="numeric"
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, '') })}
          required
        />
        <input
          aria-label="limit"
          placeholder="limit"
          inputMode="numeric"
          value={form.usageLimit}
          onChange={(e) => setForm({ ...form, usageLimit: e.target.value.replace(/\D/g, '') })}
        />
        <button className="btn primary" disabled={create.isPending}>
          {t('act.create')}
        </button>
      </form>
      <StateView
        loading={q.isLoading}
        error={q.error}
        empty={q.data?.length === 0}
        onRetry={() => q.refetch()}
      >
        {q.data && (
          <Table
            cols={[
              { header: t('col.code'), cell: (c: C) => c.code },
              {
                header: t('col.value'),
                cell: (c) => (c.type === 'PERCENT' ? `${c.value}%` : `${c.value / 100}`),
              },
              {
                header: t('col.used'),
                cell: (c) => `${c.usedCount}${c.usageLimit ? ` / ${c.usageLimit}` : ''}`,
              },
              {
                header: t('col.status'),
                cell: (c) => <Badge value={c.active ? 'ACTIVE' : 'SUSPENDED'} />,
              },
              {
                header: t('col.actions'),
                cell: (c) => (
                  <button className="btn sm" onClick={() => toggle.mutate(c)}>
                    {c.active ? t('act.deactivate') : t('act.activate')}
                  </button>
                ),
              },
            ]}
            rows={q.data}
          />
        )}
      </StateView>
    </>
  );
}
