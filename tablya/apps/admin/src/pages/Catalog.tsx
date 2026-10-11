import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { StateView, Table, useToast, errMsg } from '../components/ui';
import { useI18n } from '../i18n';

interface Cat {
  id: string;
  slug: string;
  name: string;
  nameAr: string;
  active: boolean;
}

export function Catalog() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['categories'], queryFn: () => api<Cat[]>('/categories') });
  const [f, setF] = useState({ slug: '', name: '', nameAr: '' });
  const create = useMutation({
    mutationFn: () => api('/admin/categories', { method: 'POST', body: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setF({ slug: '', name: '', nameAr: '' });
      toast(t('toast.done'));
    },
    onError: (e) => toast(errMsg(e, t('toast.failed')), 'bad'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <>
      <h1>{t('nav.catalog')}</h1>
      <form className="card toolbar" onSubmit={submit}>
        <input
          aria-label={t('cat.slug')}
          placeholder={t('cat.slug')}
          pattern="[a-z0-9-]{2,40}"
          value={f.slug}
          onChange={(e) => setF({ ...f, slug: e.target.value })}
          required
        />
        <input
          aria-label={t('col.name')}
          placeholder={t('col.name')}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          required
        />
        <input
          aria-label={t('cat.nameAr')}
          placeholder={t('cat.nameAr')}
          dir="rtl"
          value={f.nameAr}
          onChange={(e) => setF({ ...f, nameAr: e.target.value })}
          required
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
              { header: t('cat.slug'), cell: (c: Cat) => c.slug },
              { header: t('col.name'), cell: (c) => c.name },
              { header: t('cat.nameAr'), cell: (c) => <span dir="rtl">{c.nameAr}</span> },
            ]}
            rows={q.data}
          />
        )}
      </StateView>
    </>
  );
}
