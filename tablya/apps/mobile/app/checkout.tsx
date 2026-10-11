import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Totals } from '../src/components/Totals';
import { AsyncView, Button, Card, Field, Row, Screen, toast, Txt } from '../src/components/ui';
import { track } from '../src/lib/analytics';
import { api, ApiError, newIdempotencyKey } from '../src/lib/api';
import { errorMessage } from '../src/lib/errors';
import { useT } from '../src/lib/i18n';
import { radius, space, useColors } from '../src/lib/theme';
import type { Address, CartView, OrderView } from '../src/lib/types';

type Fulfillment = 'DELIVERY' | 'PICKUP';
type Method = 'CARD' | 'CASH_ON_DELIVERY';
interface Placed {
  order: OrderView;
  payment: { providerRef?: string; clientSession?: Record<string, string> } | null;
}

export default function Checkout() {
  const { t, locale, pick } = useT();
  const c = useColors();
  const qc = useQueryClient();
  const [fulfillment, setFulfillment] = useState<Fulfillment>('DELIVERY');
  const [method, setMethod] = useState<Method>('CASH_ON_DELIVERY');
  const [addressId, setAddressId] = useState<string | undefined>();
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [retryable, setRetryable] = useState(false);
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<Address[]>('/me/addresses'),
  });
  useEffect(() => {
    if (!addressId && addresses.data?.length)
      setAddressId((addresses.data.find((a) => a.isDefault) ?? addresses.data[0]).id);
  }, [addresses.data, addressId]);
  useEffect(() => {
    track('checkout_started');
  }, []);

  const quote = useQuery({
    queryKey: ['quote', fulfillment, addressId, appliedCoupon],
    enabled: fulfillment === 'PICKUP' || !!addressId,
    queryFn: () =>
      api<CartView>('/checkout/quote', {
        method: 'POST',
        body: {
          fulfillment,
          ...(fulfillment === 'DELIVERY' ? { addressId } : {}),
          ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
        },
      }),
  });

  const place = useMutation({
    mutationFn: async () => {
      const total = quote.data?.pricing?.total ?? 0;
      const body = {
        fulfillment,
        paymentMethod: method,
        expectedTotal: total,
        ...(fulfillment === 'DELIVERY' ? { addressId } : {}),
        ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const sig = JSON.stringify(body);
      // One key per distinct intent. A retry after a timeout reuses it, so the server can never create a second order.
      if (attempt.current?.sig !== sig) attempt.current = { sig, key: newIdempotencyKey() };
      return api<Placed>('/orders', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': attempt.current.key },
      });
    },
    onSuccess: async (r) => {
      setRetryable(false);
      track('order_created');
      await qc.invalidateQueries({ queryKey: ['cart'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      if (r.order.paymentMethod === 'CARD' && r.order.status === 'PENDING_PAYMENT') setPlaced(r);
      else router.replace(`/order/${r.order.id}`);
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.isNetwork) setRetryable(true);
      else {
        attempt.current = null;
        if (
          e instanceof ApiError &&
          ['PRICE_CHANGED', 'ITEM_UNAVAILABLE', 'KITCHEN_UNAVAILABLE'].includes(e.body.code)
        )
          void quote.refetch();
        toast(
          e instanceof ApiError && e.body.code === 'PRICE_CHANGED'
            ? t('checkout.priceChanged')
            : errorMessage(e, locale),
          'bad',
        );
      }
    },
  });

  const issues = quote.data?.issues ?? [];
  const canPlace = !!quote.data?.pricing && issues.length === 0 && !quote.isFetching;

  if (placed) return <PayStep placed={placed} />;

  const choice = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: active ? c.brand : c.border,
        backgroundColor: active ? c.brandSoft : c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.sm,
      }}
    >
      <Txt variant="label">{label}</Txt>
    </Pressable>
  );
  return (
    <Screen
      footer={
        <View style={{ padding: space.lg, gap: space.sm }}>
          {retryable && (
            <Txt variant="small" color={c.warn} accessibilityRole="alert">
              {t('checkout.retryHint')}
            </Txt>
          )}
          <Button
            title={place.isPending ? t('checkout.processing') : t('checkout.placeOrder')}
            onPress={() => place.mutate()}
            loading={place.isPending}
            disabled={!canPlace}
          />
        </View>
      }
    >
      <Txt variant="h2" accessibilityRole="header">
        {t('checkout.method')}
      </Txt>
      <Row>
        {choice(t('checkout.delivery'), fulfillment === 'DELIVERY', () =>
          setFulfillment('DELIVERY'),
        )}
        {choice(t('checkout.pickup'), fulfillment === 'PICKUP', () => setFulfillment('PICKUP'))}
      </Row>

      {fulfillment === 'DELIVERY' && (
        <>
          <Txt variant="h2" accessibilityRole="header">
            {t('checkout.address')}
          </Txt>
          <AsyncView query={addresses}>
            {(list) => (
              <>
                {list.map((a) => (
                  <Card
                    key={a.id}
                    onPress={() => setAddressId(a.id)}
                    label={a.line1}
                    style={
                      a.id === addressId ? { borderColor: c.brand, borderWidth: 2 } : undefined
                    }
                  >
                    <Txt variant="label">{a.label ?? a.city}</Txt>
                    <Txt muted>
                      {a.line1}, {a.city}
                    </Txt>
                  </Card>
                ))}
                <Button
                  title={t('checkout.addAddress')}
                  variant="secondary"
                  onPress={() => router.push('/addresses')}
                />
              </>
            )}
          </AsyncView>
        </>
      )}

      <Txt variant="h2" accessibilityRole="header">
        {t('checkout.payment')}
      </Txt>
      <Row>
        {choice(t('checkout.cash'), method === 'CASH_ON_DELIVERY', () =>
          setMethod('CASH_ON_DELIVERY'),
        )}
        {choice(t('checkout.card'), method === 'CARD', () => setMethod('CARD'))}
      </Row>

      <Row style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t('checkout.coupon')}
            value={coupon}
            onChangeText={(v) => setCoupon(v.toUpperCase())}
            autoCapitalize="characters"
          />
        </View>
        <Button
          title={t('checkout.apply')}
          variant="secondary"
          onPress={() => setAppliedCoupon(coupon.trim() || undefined)}
        />
      </Row>
      <Field
        label={t('checkout.note')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={300}
      />

      {issues.length > 0 && (
        <Card style={{ borderColor: c.danger }}>
          {issues.map((i, n) => (
            <Txt key={n} color={c.danger}>
              • {i.message}
            </Txt>
          ))}
        </Card>
      )}
      {quote.isLoading ? (
        <Txt muted>{t('common.loading')}</Txt>
      ) : quote.data?.pricing ? (
        <Totals p={quote.data.pricing} />
      ) : null}
      {quote.data && (
        <Txt variant="small" muted>
          {quote.data.lines.map((l) => `${l.quantity}× ${pick(l.name, l.nameAr)}`).join(', ')}
        </Txt>
      )}
    </Screen>
  );
}

/**
 * Card payment step. In production this hosts the payment gateway SDK (see docs/ARCHITECTURE.md → Payments).
 * The order is only confirmed when the gateway's signed webhook reaches the server; this screen merely polls.
 */
function PayStep({ placed }: { placed: Placed }) {
  const { t, locale } = useT();
  const sandbox = placed.payment?.clientSession?.mode === 'sandbox';
  const [busy, setBusy] = useState(false);
  const order = useQuery({
    queryKey: ['order', placed.order.id],
    queryFn: () => api<OrderView>(`/orders/${placed.order.id}`),
    refetchInterval: 2500,
  });
  useEffect(() => {
    if (order.data && order.data.status !== 'PENDING_PAYMENT')
      router.replace(`/order/${placed.order.id}`);
  }, [order.data, placed.order.id]);
  const complete = async (outcome: 'success' | 'fail') => {
    setBusy(true);
    try {
      await api(`/payments/sandbox/${placed.payment?.providerRef}/complete`, {
        method: 'POST',
        body: { outcome },
      });
      void order.refetch();
    } catch (e) {
      toast(errorMessage(e, locale), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Txt variant="h2" accessibilityRole="header">
        {t('checkout.awaiting')}
      </Txt>
      {sandbox ? (
        <>
          <Button
            title={t('checkout.paySandbox')}
            onPress={() => void complete('success')}
            loading={busy}
          />
          <Button
            title={t('common.cancel')}
            variant="secondary"
            onPress={() => void complete('fail')}
            disabled={busy}
          />
        </>
      ) : (
        <Txt color="#B3261E">{t('checkout.payUnavailable')}</Txt>
      )}
      <Button
        title={t('tab.orders')}
        variant="ghost"
        onPress={() => router.replace(`/order/${placed.order.id}`)}
      />
    </Screen>
  );
}
