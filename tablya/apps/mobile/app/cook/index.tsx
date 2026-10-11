import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { statusTone } from '../../src/components/domain';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Pill,
  Row,
  Screen,
  SkeletonList,
  toast,
  Txt,
} from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCookKitchen } from '../../src/lib/cook';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import { radius, useColors } from '../../src/lib/theme';
import type { OrderView } from '../../src/lib/types';

type Scope = 'pending' | 'active' | 'done';
const NEXT: Record<string, { to: string; label: string }[]> = {
  ACCEPTED: [{ to: 'PREPARING', label: 'cook.markPreparing' }],
  PREPARING: [{ to: 'READY', label: 'cook.markReady' }],
};

export default function CookOrders() {
  const { t, locale, money } = useT();
  const c = useColors();
  const qc = useQueryClient();
  const { kitchen, isLoading: loadingK } = useCookKitchen();
  const [scope, setScope] = useState<Scope>('pending');
  const [dialog, setDialog] = useState<null | { order: OrderView; to: 'REJECTED' | 'CANCELLED' }>(
    null,
  );
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!loadingK && !kitchen) router.replace('/cook/onboarding');
  }, [loadingK, kitchen]);

  const q = useInfiniteQuery({
    queryKey: ['cook-orders', kitchen?.id, scope],
    enabled: !!kitchen,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: OrderView[]; nextCursor: string | null }>(
        `/cook/kitchens/${kitchen!.id}/orders?scope=${scope}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });
  const move = useMutation({
    mutationFn: (v: { id: string; to: string; reason?: string }) =>
      api(`/cook/orders/${v.id}/transition`, {
        method: 'POST',
        body: { to: v.to, ...(v.reason ? { reason: v.reason } : {}) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cook-orders'] }),
    onError: (e) => {
      toast(errorMessage(e, locale), 'bad');
      void qc.invalidateQueries({ queryKey: ['cook-orders'] });
    },
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const actions = (o: OrderView) => {
    if (o.status === 'PLACED')
      return (
        <Row>
          <Button
            title={t('cook.accept')}
            onPress={() => move.mutate({ id: o.id, to: 'ACCEPTED' })}
            style={{ flex: 1 }}
          />
          <Button
            title={t('cook.reject')}
            variant="danger"
            onPress={() => {
              setReason('');
              setDialog({ order: o, to: 'REJECTED' });
            }}
          />
        </Row>
      );
    const list = [...(NEXT[o.status] ?? [])];
    if (o.status === 'READY')
      list.push(
        o.fulfillment === 'DELIVERY'
          ? { to: 'OUT_FOR_DELIVERY', label: 'cook.handover' }
          : { to: 'DELIVERED', label: 'cook.complete' },
      );
    if (o.status === 'OUT_FOR_DELIVERY') list.push({ to: 'DELIVERED', label: 'cook.complete' });
    return (
      <Row>
        {list.map((a) => (
          <Button
            key={a.to}
            title={t(a.label)}
            onPress={() => move.mutate({ id: o.id, to: a.to })}
            style={{ flex: 1 }}
          />
        ))}
        {['ACCEPTED', 'PREPARING'].includes(o.status) && (
          <Button
            title={t('common.cancel')}
            variant="ghost"
            onPress={() => {
              setReason('');
              setDialog({ order: o, to: 'CANCELLED' });
            }}
          />
        )}
      </Row>
    );
  };

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Row accessibilityRole="tablist">
        {(['pending', 'active', 'done'] as Scope[]).map((s) => (
          <Pressable
            key={s}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === s }}
            onPress={() => setScope(s)}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: scope === s ? c.brand : c.surface,
              borderWidth: 1,
              borderColor: scope === s ? c.brand : c.border,
            }}
          >
            <Txt variant="label" color={scope === s ? c.onBrand : c.text}>
              {s === 'done' ? t('common.done') : t(`cook.${s}`)}
            </Txt>
          </Pressable>
        ))}
      </Row>
      {loadingK || q.isLoading ? (
        <SkeletonList rows={3} />
      ) : q.error && !items.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('cook.noOrders')} />
      ) : (
        items.map((o) => (
          <Card key={o.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="h3">
                #{o.orderNo} · {o.customer?.name}
              </Txt>
              <Pill text={t(`order.status.${o.status}`)} tone={statusTone(o.status)} />
            </Row>
            {o.items.map((i) => (
              <View key={i.id}>
                <Txt>
                  {i.quantity}× {i.name}
                </Txt>
                {i.note ? (
                  <Txt variant="small" muted>
                    “{i.note}”
                  </Txt>
                ) : null}
              </View>
            ))}
            <Txt variant="small" muted>
              {o.fulfillment === 'PICKUP' ? t('checkout.pickup') : t('checkout.delivery')} ·{' '}
              {o.paymentMethod === 'CASH_ON_DELIVERY' ? t('checkout.cash') : t('checkout.card')} ·{' '}
              {money(o.totalMinor, o.currency)}
            </Txt>
            {o.customer?.phone ? (
              <Txt variant="small" muted>
                {o.customer.phone}
              </Txt>
            ) : null}
            {actions(o)}
          </Card>
        ))
      )}
      <ConfirmDialog
        visible={!!dialog}
        title={dialog?.to === 'REJECTED' ? t('cook.reject') : t('cook.cancelConfirm')}
        confirmLabel={dialog?.to === 'REJECTED' ? t('cook.reject') : t('common.yes')}
        danger
        confirmDisabled={reason.trim().length < 3}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog)
            await move
              .mutateAsync({ id: dialog.order.id, to: dialog.to, reason: reason.trim() })
              .catch(() => undefined);
          setDialog(null);
        }}
      >
        <Field
          label={t('cook.rejectReason')}
          value={reason}
          onChangeText={setReason}
          maxLength={300}
        />
      </ConfirmDialog>
    </Screen>
  );
}
