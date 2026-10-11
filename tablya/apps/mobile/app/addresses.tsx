import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AsyncView,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Row,
  Screen,
  toast,
  Txt,
} from '../src/components/ui';
import { api } from '../src/lib/api';
import { errorMessage } from '../src/lib/errors';
import { useT } from '../src/lib/i18n';
import { requestLocation, useLocation } from '../src/lib/location';
import type { Address } from '../src/lib/types';

export default function Addresses() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const coords = useLocation((s) => s.coords);
  const q = useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/me/addresses') });
  const [form, setForm] = useState({ label: '', line1: '', city: '' });
  const [pos, setPos] = useState(coords);
  const [toDelete, setToDelete] = useState<Address | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] });
  const save = useMutation({
    mutationFn: () =>
      api('/me/addresses', {
        method: 'POST',
        body: {
          ...(form.label ? { label: form.label } : {}),
          line1: form.line1.trim(),
          city: form.city.trim(),
          lat: pos!.lat,
          lng: pos!.lng,
        },
      }),
    onSuccess: () => {
      setForm({ label: '', line1: '', city: '' });
      void refresh();
    },
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const locate = async () => {
    try {
      const p = await requestLocation();
      if (p) setPos(p);
      else toast(t('addr.needLocation'), 'bad');
    } catch (e) {
      toast(errorMessage(e, locale), 'bad');
    }
  };
  return (
    <Screen>
      <AsyncView query={q}>
        {(list) => (
          <>
            {list.map((a) => (
              <Card key={a.id}>
                <Txt variant="label">
                  {a.label ?? a.city}
                  {a.isDefault ? ' ★' : ''}
                </Txt>
                <Txt muted>
                  {a.line1}, {a.city}
                </Txt>
                <Button title={t('common.delete')} variant="ghost" onPress={() => setToDelete(a)} />
              </Card>
            ))}
          </>
        )}
      </AsyncView>
      <Card>
        <Field
          label={t('addr.label')}
          value={form.label}
          onChangeText={(v) => setForm({ ...form, label: v })}
        />
        <Field
          label={t('addr.line1')}
          value={form.line1}
          onChangeText={(v) => setForm({ ...form, line1: v })}
        />
        <Field
          label={t('addr.city')}
          value={form.city}
          onChangeText={(v) => setForm({ ...form, city: v })}
        />
        <Row>
          <Button title={t('addr.useLocation')} variant="secondary" onPress={locate} />
          {pos && (
            <Txt variant="small" muted>
              {pos.lat.toFixed(3)}, {pos.lng.toFixed(3)}
            </Txt>
          )}
        </Row>
        <Button
          title={t('addr.save')}
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={!pos || !form.line1.trim() || !form.city.trim()}
        />
      </Card>
      <ConfirmDialog
        visible={!!toDelete}
        title={t('common.delete')}
        body={toDelete?.line1}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await del.mutateAsync(toDelete.id);
          setToDelete(null);
        }}
      />
    </Screen>
  );
}
