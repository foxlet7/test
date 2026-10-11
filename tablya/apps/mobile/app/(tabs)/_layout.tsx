import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useT } from '../../src/lib/i18n';
import { useColors } from '../../src/lib/theme';

export default function TabsLayout() {
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
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarIcon: icon('home') }} />
      <Tabs.Screen name="search" options={{ title: t('tab.search'), tabBarIcon: icon('search') }} />
      <Tabs.Screen
        name="orders"
        options={{ title: t('tab.orders'), tabBarIcon: icon('receipt') }}
      />
      <Tabs.Screen
        name="favorites"
        options={{ title: t('tab.favorites'), tabBarIcon: icon('heart') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('tab.profile'), tabBarIcon: icon('person') }}
      />
    </Tabs>
  );
}
