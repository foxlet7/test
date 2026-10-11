import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { statusTone } from '../../src/components/domain';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Pill,
  Row,
  Screen,
  SkeletonList,
  Txt,
} from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useT } from '../../src/lib/i18n';
import type { OrderView } from '../../src/lib/types';

export default function Orders() {
  const { t, money, pick } = useT();
  const q = useInfiniteQuery({
    queryKey: ['orders'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: OrderView[]; nextCursor: string | null }>(
        `/orders${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchInterval: 20_000,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.isLoading ? (
        <SkeletonList rows={3} />
      ) : q.error && !items.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('orders.empty')} />
      ) : (
        <>
          {items.map((o) => (
            <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)} label={`#${o.orderNo}`}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="h3">
                  {o.kitchen ? pick(o.kitchen.name, o.kitchen.nameAr) : `#${o.orderNo}`}
                </Txt>
                <Pill text={t(`order.status.${o.status}`)} tone={statusTone(o.status)} />
              </Row>
              <Txt variant="small" muted>
                #{o.orderNo} · {new Date(o.createdAt).toLocaleDateString()} ·{' '}
                {money(o.totalMinor, o.currency)}
              </Txt>
            </Card>
          ))}
          {q.hasNextPage && (
            <Button
              title={t('home.seeAll')}
              variant="secondary"
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          )}
        </>
      )}
    </Screen>
  );
}
