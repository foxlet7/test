import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  DishRow,
  KitchenCard,
  type DishData,
  type KitchenCardData,
} from '../../src/components/domain';
import { AsyncView, Screen, Txt } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useT } from '../../src/lib/i18n';

export default function Favorites() {
  const { t } = useT();
  const q = useQuery({
    queryKey: ['favorites'],
    queryFn: () => api<{ kitchens: KitchenCardData[]; items: DishData[] }>('/favorites'),
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <AsyncView query={q} empty={(d) => !d.kitchens.length && !d.items.length}>
        {(d) => (
          <>
            {d.kitchens.length > 0 && (
              <Txt variant="h2" accessibilityRole="header">
                {t('search.kitchens')}
              </Txt>
            )}
            {d.kitchens.map((k) => (
              <KitchenCard key={k.id} k={k} />
            ))}
            {d.items.length > 0 && (
              <Txt variant="h2" accessibilityRole="header">
                {t('search.dishes')}
              </Txt>
            )}
            {d.items.map((i) => (
              <DishRow key={i.id} d={i} onPress={() => router.push(`/item/${i.id}`)} />
            ))}
          </>
        )}
      </AsyncView>
    </Screen>
  );
}
