import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastHost } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { useI18n, useT } from '../src/lib/i18n';
import { queryClient } from '../src/lib/network';
import { registerForPush } from '../src/lib/push';
import { useColors } from '../src/lib/theme';

function Gate() {
  const status = useAuth((s) => s.status);
  const ready = useI18n((s) => s.ready);
  const segments = useSegments();
  const router = useRouter();
  const c = useColors();
  const { t } = useT();

  useEffect(() => {
    void useI18n.getState().init();
    void useAuth.getState().init();
  }, []);

  useEffect(() => {
    if (status === 'loading' || !ready) return;
    const inAuth = segments[0] === '(auth)';
    if (status === 'out' && !inAuth) router.replace('/welcome');
    if (status === 'in' && inAuth) router.replace('/');
    if (status === 'in') void registerForPush();
  }, [status, ready, segments, router]);

  if (status === 'loading' || !ready) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}
      >
        <ActivityIndicator color={c.brand} size="large" />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        contentStyle: { backgroundColor: c.bg },
        headerBackTitle: t('common.back'),
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="cook" options={{ headerShown: false }} />
      <Stack.Screen name="kitchen/[id]" options={{ title: '' }} />
      <Stack.Screen name="item/[id]" options={{ presentation: 'modal', title: '' }} />
      <Stack.Screen name="cart" options={{ title: t('cart.title') }} />
      <Stack.Screen name="checkout" options={{ title: t('cart.checkout') }} />
      <Stack.Screen name="addresses" options={{ title: t('profile.addresses') }} />
      <Stack.Screen name="order/[id]" options={{ title: '' }} />
      <Stack.Screen
        name="review/[orderId]"
        options={{ presentation: 'modal', title: t('review.title') }}
      />
      <Stack.Screen name="settings/delete-account" options={{ title: t('auth.deleteTitle') }} />
    </Stack>
  );
}

export default function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
          <Gate />
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
