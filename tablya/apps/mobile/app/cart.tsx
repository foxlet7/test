import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Totals } from '../src/components/Totals';
import { AsyncView, Button, Card, EmptyState, Row, Screen, toast, Txt } from '../src/components/ui';
import { api } from '../src/lib/api';
import { errorMessage } from '../src/lib/errors';
import { useT } from '../src/lib/i18n';
import { space, useColors } from '../src/lib/theme';
import type { CartView } from '../src/lib/types';

export default function CartScreen() {
  const { t, locale, money, pick } = useT();
  const c = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cart'], queryFn: () => api<CartView>('/cart') });
  const done = () => qc.invalidateQueries({ queryKey: ['cart'] });
  const setQty = useMutation({
    mutationFn: (v: { id: string; quantity: number }) =>
      api(`/cart/items/${v.id}`, { method: 'PATCH', body: { quantity: v.quantity } }),
    onSuccess: done,
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/cart/items/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const clear = useMutation({
    mutationFn: () => api('/cart', { method: 'DELETE' }),
    onSuccess: done,
  });
  return (
    <Screen
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      footer={
        q.data?.lines.length ? (
          <View style={{ padding: space.lg }}>
            <Button
              title={`${t('cart.checkout')} · ${q.data.pricing ? money(q.data.pricing.subtotal) : ''}`}
              onPress={() => router.push('/checkout')}
              disabled={(q.data?.issues.length ?? 0) > 0}
            />
          </View>
        ) : undefined
      }
    >
      <AsyncView query={q}>
        {(cart) =>
          cart.lines.length === 0 ? (
            <EmptyState title={t('cart.empty')} />
          ) : (
            <>
              {cart.issues.length > 0 && (
                <Card style={{ borderColor: c.danger }}>
                  <Txt variant="h3" color={c.danger}>
                    {t('cart.issues')}
                  </Txt>
                  {cart.issues.map((i, n) => (
                    <Txt key={n} variant="small">
                      • {i.message}
                    </Txt>
                  ))}
                </Card>
              )}
              {cart.lines.map((l) => (
                <Card key={l.cartItemId}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt variant="h3" style={{ flex: 1 }}>
                      {pick(l.name, l.nameAr)}
                    </Txt>
                    <Txt variant="label">{money(l.lineTotalMinor)}</Txt>
                  </Row>
                  {l.options.length > 0 && (
                    <Txt variant="small" muted>
                      {l.options.map((o) => pick(o.name, o.nameAr)).join(' · ')}
                    </Txt>
                  )}
                  {l.note ? (
                    <Txt variant="small" muted>
                      “{l.note}”
                    </Txt>
                  ) : null}
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row>
                      <Button
                        title="−"
                        variant="secondary"
                        disabled={l.quantity <= 1}
                        onPress={() =>
                          setQty.mutate({ id: l.cartItemId, quantity: l.quantity - 1 })
                        }
                        style={{ width: 52 }}
                      />
                      <Txt variant="h3" accessibilityLabel={String(l.quantity)}>
                        {l.quantity}
                      </Txt>
                      <Button
                        title="+"
                        variant="secondary"
                        onPress={() =>
                          setQty.mutate({ id: l.cartItemId, quantity: l.quantity + 1 })
                        }
                        style={{ width: 52 }}
                      />
                    </Row>
                    <Button
                      title={t('common.remove')}
                      variant="ghost"
                      onPress={() => remove.mutate(l.cartItemId)}
                    />
                  </Row>
                </Card>
              ))}
              {cart.pricing && <Totals p={cart.pricing} />}
              <Button title={t('cart.clear')} variant="ghost" onPress={() => clear.mutate()} />
            </>
          )
        }
      </AsyncView>
    </Screen>
  );
}
