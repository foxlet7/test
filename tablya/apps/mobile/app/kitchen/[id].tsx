import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { availabilityTone, Cover, DishRow } from '../../src/components/domain';
import {
  AsyncView,
  Button,
  Card,
  ConfirmDialog,
  Pill,
  Row,
  Screen,
  SkeletonList,
  toast,
  Txt,
} from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';
import { useLocation } from '../../src/lib/location';
import { space, useColors } from '../../src/lib/theme';
import type { CartView, KitchenDetail } from '../../src/lib/types';

const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function KitchenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale, money, pick } = useT();
  const c = useColors();
  const qc = useQueryClient();
  const coords = useLocation((s) => s.coords);
  const [reporting, setReporting] = useState(false);
  const q = useQuery({
    queryKey: ['kitchen', id, coords],
    queryFn: () =>
      api<KitchenDetail>(`/kitchens/${id}${coords ? `?lat=${coords.lat}&lng=${coords.lng}` : ''}`, {
        auth: false,
      }),
  });
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<CartView>('/cart') });
  const fav = useMutation({
    mutationFn: () => api(`/favorites/kitchens/${id}`, { method: 'POST' }),
    onSuccess: () => {
      toast(t('common.done'));
      void qc.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const report = useMutation({
    mutationFn: (reason: string) =>
      api('/reports', { method: 'POST', body: { targetType: 'KITCHEN', targetId: id, reason } }),
    onSuccess: () => {
      setReporting(false);
      toast(t('common.reportSent'));
    },
    onError: (e) => toast(errorMessage(e, locale), 'bad'),
  });
  const days = locale === 'ar' ? DAYS_AR : DAYS_EN;
  const k = q.data;
  const cartCount = cart.data?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
  return (
    <>
      <Stack.Screen options={{ title: k ? pick(k.name, k.nameAr) : '' }} />
      <Screen
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching}
        footer={
          cartCount > 0 && cart.data?.kitchenId === id ? (
            <View style={{ padding: space.lg }}>
              <Button
                title={`${t('cart.title')} (${cartCount}) · ${money(cart.data?.pricing?.subtotal ?? 0)}`}
                onPress={() => router.push('/cart')}
              />
            </View>
          ) : undefined
        }
      >
        <AsyncView query={q} skeleton={<SkeletonList rows={2} />}>
          {(k) => (
            <View style={{ gap: space.lg }}>
              <Cover url={k.coverUrl} height={180} label={pick(k.name, k.nameAr)} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="h1" style={{ flex: 1 }} accessibilityRole="header">
                  {pick(k.name, k.nameAr)}
                </Txt>
                <Pill
                  text={t(`kitchen.${k.availability.toLowerCase()}`)}
                  tone={availabilityTone(k.availability)}
                />
              </Row>
              <Txt muted>{pick(k.description, k.descriptionAr)}</Txt>
              <Row gap={space.lg} style={{ flexWrap: 'wrap' }}>
                <Txt>
                  ★ {k.ratingCount ? k.ratingAvg.toFixed(1) : '—'} ({k.ratingCount})
                </Txt>
                <Txt muted>{t('kitchen.min.prep', { n: k.prepTimeMin })}</Txt>
                <Txt muted>{t('kitchen.min', { amount: money(k.minOrderMinor) })}</Txt>
                {k.deliveryFeeFromMinor != null && (
                  <Txt muted>{t('kitchen.delivery', { fee: money(k.deliveryFeeFromMinor) })}</Txt>
                )}
              </Row>
              <Row>
                <Button
                  title={t('kitchen.favorite')}
                  variant="secondary"
                  onPress={() => fav.mutate()}
                  loading={fav.isPending}
                />
                <Button
                  title={t('kitchen.report')}
                  variant="ghost"
                  onPress={() => setReporting(true)}
                />
              </Row>
              {k.availability !== 'OPEN' && (
                <Card style={{ backgroundColor: c.brandSoft }}>
                  <Txt>{t(`kitchen.${k.availability.toLowerCase()}`)}</Txt>
                </Card>
              )}
              <Txt variant="h2" accessibilityRole="header">
                {t('kitchen.menu')}
              </Txt>
              {k.menu.map((d) => (
                <DishRow key={d.id} d={d} onPress={() => router.push(`/item/${d.id}`)} />
              ))}
              {k.policies ? (
                <Card>
                  <Txt variant="h3">{t('kitchen.policies')}</Txt>
                  <Txt muted>{k.policies}</Txt>
                </Card>
              ) : null}
              <Card>
                <Txt variant="h3">{t('kitchen.hours')}</Txt>
                {k.schedule.length === 0 ? (
                  <Txt muted>—</Txt>
                ) : (
                  [...k.schedule]
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                    .map((s, i) => (
                      <Txt key={i} variant="small" muted>
                        {days[s.dayOfWeek]}: {hhmm(s.openMinute)} – {hhmm(s.closeMinute)}
                      </Txt>
                    ))
                )}
              </Card>
              <Txt variant="h2" accessibilityRole="header">
                {t('kitchen.reviews')}
              </Txt>
              {k.reviews.length === 0 ? (
                <Txt muted>{t('kitchen.noReviews')}</Txt>
              ) : (
                k.reviews.map((r) => (
                  <Card key={r.id}>
                    <Txt variant="label">
                      {'★'.repeat(r.rating)} · {r.author}
                    </Txt>
                    {r.text ? <Txt>{r.text}</Txt> : null}
                  </Card>
                ))
              )}
            </View>
          )}
        </AsyncView>
      </Screen>
      <ConfirmDialog
        visible={reporting}
        title={t('common.report')}
        confirmLabel={t('common.close')}
        onCancel={() => setReporting(false)}
        onConfirm={() => setReporting(false)}
      >
        <View style={{ gap: space.sm }}>
          {(['SPAM', 'ABUSE', 'UNSAFE_FOOD', 'FRAUD', 'INAPPROPRIATE', 'OTHER'] as const).map(
            (r) => (
              <Button
                key={r}
                title={t(`report.reason.${r}`)}
                variant="secondary"
                onPress={() => report.mutate(r)}
              />
            ),
          )}
        </View>
      </ConfirmDialog>
    </>
  );
}
