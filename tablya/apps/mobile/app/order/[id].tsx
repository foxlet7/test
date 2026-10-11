import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { statusTone } from '../../src/components/domain';
import {
  AsyncView,
  Button,
  Card,
  ConfirmDialog,
  Pill,
  Row,
  Screen,
  toast,
  Txt,
} from '../../src/components/ui';
import { api, ApiError } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import { space, useColors } from '../../src/lib/theme';
import type { OrderView } from '../../src/lib/types';

const FLOW = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale, money, pick } = useT();
  const c = useColors();
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderView>(`/orders/${id}`),
    refetchInterval: 8000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const act = useMutation({
    mutationFn: (path: string) =>
      api(`/orders/${id}/${path}`, { method: 'POST', body: path === 'cancel' ? {} : undefined }),
    onSuccess: refresh,
    onError: (e) => {
      toast(errorMessage(e, locale), 'bad');
      if (e instanceof ApiError && e.body.code === 'ILLEGAL_TRANSITION') refresh();
    },
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <AsyncView query={q}>
        {(o) => {
          const reached = new Set(o.history.map((h) => h.to));
          const flow =
            o.fulfillment === 'PICKUP' ? FLOW.filter((s) => s !== 'OUT_FOR_DELIVERY') : FLOW;
          const terminal = ['CANCELLED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED'].includes(
            o.status,
          );
          return (
            <View style={{ gap: space.lg }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="h1" accessibilityRole="header">
                  #{o.orderNo}
                </Txt>
                <Pill text={t(`order.status.${o.status}`)} tone={statusTone(o.status)} />
              </Row>
              {o.kitchen && <Txt variant="h3">{pick(o.kitchen.name, o.kitchen.nameAr)}</Txt>}
              {o.cancelReason ? (
                <Card>
                  <Txt>{o.cancelReason}</Txt>
                </Card>
              ) : null}
              <Card>
                <Txt variant="h3">{t('orders.timeline')}</Txt>
                {(terminal ? o.history.map((h) => h.to) : flow).map((s) => {
                  const done = reached.has(s);
                  return (
                    <Row
                      key={s}
                      accessibilityLabel={`${t(`order.status.${s}`)}${done ? ' ✓' : ''}`}
                    >
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: done ? c.ok : c.border,
                        }}
                      />
                      <Txt muted={!done} variant={o.status === s ? 'label' : 'body'}>
                        {t(`order.status.${s}`)}
                      </Txt>
                    </Row>
                  );
                })}
                {o.etaMinutes &&
                !terminal &&
                o.status !== 'COMPLETED' &&
                o.status !== 'DELIVERED' ? (
                  <Txt variant="small" muted>
                    {t('orders.reorderHint', { n: o.etaMinutes })}
                  </Txt>
                ) : null}
              </Card>
              <Card>
                {o.items.map((i) => (
                  <Row key={i.id} style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ flex: 1 }}>
                      {i.quantity}× {i.name}
                    </Txt>
                    <Txt>{money(i.lineTotalMinor, o.currency)}</Txt>
                  </Row>
                ))}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="h3">{t('cart.total')}</Txt>
                  <Txt variant="h3">{money(o.totalMinor, o.currency)}</Txt>
                </Row>
              </Card>

              {o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'CARD' && (
                <Button
                  title={t('checkout.payAgain')}
                  onPress={() => router.push('/checkout')}
                  variant="secondary"
                />
              )}
              {['PENDING_PAYMENT', 'PLACED'].includes(o.status) && (
                <Button
                  title={t('orders.cancel')}
                  variant="danger"
                  onPress={() => setCancelling(true)}
                />
              )}
              {o.status === 'DELIVERED' && (
                <Button
                  title={t('orders.received')}
                  onPress={() => act.mutate('confirm-received')}
                  loading={act.isPending}
                />
              )}
              {['DELIVERED', 'COMPLETED'].includes(o.status) && !o.reviewed && (
                <Button
                  title={t('orders.review')}
                  variant="secondary"
                  onPress={() => router.push(`/review/${o.id}`)}
                />
              )}
              <ConfirmDialog
                visible={cancelling}
                title={t('orders.cancelConfirm')}
                confirmLabel={t('orders.cancel')}
                danger
                onCancel={() => setCancelling(false)}
                onConfirm={async () => {
                  await act.mutateAsync('cancel').catch(() => undefined);
                  setCancelling(false);
                }}
              />
            </View>
          );
        }}
      </AsyncView>
    </Screen>
  );
}
