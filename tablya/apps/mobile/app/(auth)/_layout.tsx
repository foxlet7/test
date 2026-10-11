import { Stack } from 'expo-router';
import { useColors } from '../../src/lib/theme';

export default function AuthLayout() {
  const c = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />;
}
