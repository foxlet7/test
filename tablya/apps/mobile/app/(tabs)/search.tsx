import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  DishRow,
  KitchenCard,
  type DishData,
  type KitchenCardData,
} from '../../src/components/domain';
import { AsyncView, EmptyState, Field, Row, Screen, Txt } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useT } from '../../src/lib/i18n';
import { useLocation } from '../../src/lib/location';
import { radius, space, useColors } from '../../src/lib/theme';
import type { Page } from '../../src/lib/types';

const SORTS = ['relevance', 'distance', 'rating', 'prep'] as const;

function useDebounced<T>(v: T, ms = 350): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export default function Search() {
  const { t } = useT();
  const c = useColors();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const coords = useLocation((s) => s.coords);
  const [text, setText] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('relevance');
  const [openOnly, setOpenOnly] = useState(false);
  const q = useDebounced(text.trim());

  const qs = new URLSearchParams({
    sort,
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    ...(openOnly ? { openNow: 'true' } : {}),
    ...(coords ? { lat: String(coords.lat), lng: String(coords.lng) } : {}),
  });
  const kitchens = useQuery({
    queryKey: ['kitchens', qs.toString()],
    queryFn: () => api<Page<KitchenCardData>>(`/kitchens?${qs}`, { auth: false }),
  });
  const dishes = useQuery({
    queryKey: ['dish-search', q],
    enabled: q.length > 1,
    queryFn: () =>
      api<{ dishes: (DishData & { kitchen: DishData['kitchen'] })[] }>(
        `/search?q=${encodeURIComponent(q)}`,
        { auth: false },
      ),
  });

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        justifyContent: 'center',
        backgroundColor: active ? c.brand : c.surface,
        borderWidth: 1,
        borderColor: active ? c.brand : c.border,
      }}
    >
      <Txt variant="label" color={active ? c.onBrand : c.text}>
        {label}
      </Txt>
    </Pressable>
  );
  return (
    <Screen
      onRefresh={() => {
        void kitchens.refetch();
        void dishes.refetch();
      }}
      refreshing={kitchens.isRefetching}
    >
      <Field
        label={t('tab.search')}
        value={text}
        onChangeText={setText}
        placeholder={t('search.placeholder')}
        returnKeyType="search"
        autoCorrect={false}
      />
      <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
        {SORTS.map((s) => chip(t(`search.sort.${s}`), sort === s, () => setSort(s)))}
        {chip(t('search.openOnly'), openOnly, () => setOpenOnly(!openOnly))}
      </Row>
      {dishes.data && dishes.data.dishes.length > 0 && (
        <View style={{ gap: space.md }}>
          <Txt variant="h2" accessibilityRole="header">
            {t('search.dishes')}
          </Txt>
          {dishes.data.dishes.slice(0, 8).map((d) => (
            <DishRow key={d.id} d={d} onPress={() => router.push(`/item/${d.id}`)} />
          ))}
        </View>
      )}
      <Txt variant="h2" accessibilityRole="header">
        {t('search.kitchens')}
      </Txt>
      <AsyncView query={kitchens} empty={(d) => d.items.length === 0}>
        {(d) =>
          d.items.length ? (
            <>
              {d.items.map((k) => (
                <KitchenCard key={k.id} k={k} />
              ))}
            </>
          ) : (
            <EmptyState title={t('search.noResults')} />
          )
        }
      </AsyncView>
    </Screen>
  );
}
