import { useQuery } from '@tanstack/react-query';
import { AsyncView, Card, Row, Screen, Txt } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useCookKitchen } from '../../src/lib/cook';
import { useT } from '../../src/lib/i18n';

interface Dash {
  orders: { pending: number; active: number; today: number; completedToday: number };
  earnings: { availableMinor: number; earnedMinor: number; paidOutMinor: number };
  kitchen: { ratingAvg: number; ratingCount: number };
}

export default function Earnings() {
  const { t, money } = useT();
  const { kitchen } = useCookKitchen();
  const q = useQuery({
    queryKey: ['cook-dash', kitchen?.id],
    enabled: !!kitchen,
    queryFn: () => api<Dash>(`/cook/kitchens/${kitchen!.id}/dashboard`),
    refetchInterval: 30_000,
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <AsyncView query={q}>
        {(d) => (
          <>
            <Card>
              <Txt muted>{t('cook.balance')}</Txt>
              <Txt variant="h1">{money(d.earnings.availableMinor)}</Txt>
            </Card>
            <Row>
              <Card style={{ flex: 1 }}>
                <Txt muted>{t('cook.pending')}</Txt>
                <Txt variant="h2">{d.orders.pending}</Txt>
              </Card>
              <Card style={{ flex: 1 }}>
                <Txt muted>{t('cook.active')}</Txt>
                <Txt variant="h2">{d.orders.active}</Txt>
              </Card>
              <Card style={{ flex: 1 }}>
                <Txt muted>{t('cook.today')}</Txt>
                <Txt variant="h2">{d.orders.today}</Txt>
              </Card>
            </Row>
            <Card>
              <Txt muted>{t('kitchen.reviews')}</Txt>
              <Txt variant="h2">
                ★ {d.kitchen.ratingCount ? d.kitchen.ratingAvg.toFixed(1) : '—'} (
                {d.kitchen.ratingCount})
              </Txt>
            </Card>
          </>
        )}
      </AsyncView>
    </Screen>
  );
}
