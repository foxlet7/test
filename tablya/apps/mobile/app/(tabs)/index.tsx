import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { DishRow, KitchenCard } from '../../src/components/domain';
import { AsyncView, Card, EmptyState, Screen, Txt } from '../../src/components/ui';
import { track } from '../../src/lib/analytics';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useT } from '../../src/lib/i18n';
import { requestLocation, useLocation } from '../../src/lib/location';
import { radius, space, useColors } from '../../src/lib/theme';
import type { Home } from '../../src/lib/types';

export default function HomeScreen() {
  const { t, pick } = useT();
  const c = useColors();
  const user = useAuth((s) => s.user);
  const coords = useLocation((s) => s.coords);
  useEffect(() => {
    track('app_opened');
  }, []);
  const q = useQuery({
    queryKey: ['home', coords],
    queryFn: () =>
      api<Home>(`/home${coords ? `?lat=${coords.lat}&lng=${coords.lng}` : ''}`, { auth: false }),
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Txt variant="h1" accessibilityRole="header">
        {t('home.greeting', { name: user?.name.split(' ')[0] ?? '' })}
      </Txt>
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={t('home.search')}
        onPress={() => router.push('/search')}
        style={{
          minHeight: 48,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: c.border,
          backgroundColor: c.surface,
          justifyContent: 'center',
          paddingHorizontal: space.md,
        }}
      >
        <Txt muted>🔍 {t('home.search')}</Txt>
      </Pressable>
      {!coords && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void requestLocation().catch(() => undefined)}
        >
          <Txt color={c.brand}>📍 {t('welcome.location')}</Txt>
        </Pressable>
      )}
      <AsyncView query={q} empty={(d) => !d.featured.length && !d.popular.length}>
        {(d) => (
          <View style={{ gap: space.xl }}>
            {d.promotions.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.md }}
                accessibilityLabel={t('home.promotions')}
              >
                {d.promotions.map((p) => (
                  <Card key={p.id} style={{ width: 260, backgroundColor: c.brandSoft }}>
                    <Txt variant="h3">{pick(p.title, p.titleAr)}</Txt>
                    {p.couponCode && (
                      <Txt variant="label" color={c.brand}>
                        {p.couponCode}
                      </Txt>
                    )}
                  </Card>
                ))}
              </ScrollView>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm }}
              accessibilityLabel={t('home.categories')}
            >
              {d.categories.map((cat) => (
                <Pressable
                  key={cat.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/search', params: { category: cat.slug } })
                  }
                  style={{
                    minHeight: 44,
                    paddingHorizontal: space.lg,
                    borderRadius: radius.pill,
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    borderWidth: 1,
                    justifyContent: 'center',
                  }}
                >
                  <Txt variant="label">{pick(cat.name, cat.nameAr)}</Txt>
                </Pressable>
              ))}
            </ScrollView>
            {d.nearby.length > 0 && (
              <Section title={t('home.nearby')}>
                {d.nearby.map((k) => (
                  <KitchenCard key={k.id} k={k} />
                ))}
              </Section>
            )}
            <Section title={t('home.featured')}>
              {d.featured.length ? (
                d.featured.map((k) => <KitchenCard key={k.id} k={k} />)
              ) : (
                <EmptyState title={t('home.empty')} />
              )}
            </Section>
            {d.popular.length > 0 && (
              <Section title={t('home.popular')}>
                {d.popular.map((p) => (
                  <DishRow key={p.id} d={p} onPress={() => router.push(`/item/${p.id}`)} />
                ))}
              </Section>
            )}
          </View>
        )}
      </AsyncView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Txt variant="h2" accessibilityRole="header">
        {title}
      </Txt>
      {children}
    </View>
  );
}
