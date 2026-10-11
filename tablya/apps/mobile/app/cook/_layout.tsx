import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useT } from '../../src/lib/i18n';
import { useColors } from '../../src/lib/theme';

export default function CookLayout() {
  const { t } = useT();
  const c = useColors();
  const icon =
    (name: keyof typeof Ionicons.glyphMap) =>
    ({ color, size }: { color: string; size: number }) => (
      <Ionicons name={name} color={color} size={size} />
    );
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('cook.tab.orders'), tabBarIcon: icon('restaurant') }}
      />
      <Tabs.Screen name="menu" options={{ title: t('cook.tab.menu'), tabBarIcon: icon('list') }} />
      <Tabs.Screen
        name="kitchen"
        options={{ title: t('cook.tab.kitchen'), tabBarIcon: icon('storefront') }}
      />
      <Tabs.Screen
        name="earnings"
        options={{ title: t('cook.tab.earnings'), tabBarIcon: icon('cash') }}
      />
      <Tabs.Screen name="onboarding" options={{ href: null, title: t('cook.onboard.title') }} />
      <Tabs.Screen name="menu-item" options={{ href: null, title: t('cook.menu.add') }} />
    </Tabs>
  );
}
