import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch } from 'react-native';
import {
  AsyncView,
  Button,
  Card,
  ConfirmDialog,
  Row,
  Screen,
  toast,
  Txt,
} from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCookKitchen } from '../../src/lib/cook';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import type { Dish } from '../../src/lib/types';

export default function CookMenu() {
  const { t, locale, money, pick } = useT();
  const qc = useQueryClient();
  const { kitchen } = useCookKitchen();
  const q = useQuery({
    queryKey: ['cook-menu', kitchen?.id],
    enabled: !!kitchen,
    queryFn: () => api<Dish[]>(`/cook/kitchens/${kitchen!.id}/menu`),
  });
  const [del, setDel] = useState<Dish | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cook-menu'] });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: object }) =>
      api(`/cook/menu/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/cook/menu/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Button title={t('cook.menu.add')} onPress={() => router.push('/cook/menu-item')} />
      <AsyncView query={q} empty={(d) => d.length === 0}>
        {(items) => (
          <>
            {items.map((d) => (
              <Card key={d.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="h3" style={{ flex: 1 }}>
                    {pick(d.name, d.nameAr)}
                  </Txt>
                  <Txt variant="label">{money(d.priceMinor)}</Txt>
                </Row>
                {d.stock != null && (
                  <Txt variant="small" muted>
                    {t('cook.menu.stock')}: {String(d.stock)}
                  </Txt>
                )}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row>
                    <Switch
                      accessibilityLabel={t('cook.menu.available')}
                      value={d.isAvailable}
                      onValueChange={(v) => patch.mutate({ id: d.id, body: { isAvailable: v } })}
                    />
                    <Txt>{t('cook.menu.available')}</Txt>
                  </Row>
                  <Button title={t('common.delete')} variant="ghost" onPress={() => setDel(d)} />
                </Row>
              </Card>
            ))}
          </>
        )}
      </AsyncView>
      <ConfirmDialog
        visible={!!del}
        title={t('cook.menu.delete')}
        body={t('cook.menu.deleteConfirm')}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          if (del) await remove.mutateAsync(del.id);
          setDel(null);
        }}
      />
    </Screen>
  );
}
