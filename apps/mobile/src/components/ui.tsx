import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLang } from '../i18n';
import { useTheme } from '../theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const th = useTheme();
  const { rtl } = useLang();
  const body = <View style={{ padding: 16, gap: 12, direction: rtl ? 'rtl' : 'ltr' }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: th.bg }} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const th = useTheme();
  return <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700', color: th.fg }}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  const th = useTheme();
  return <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: th.fg, marginTop: 8 }}>{children}</Text>;
}
export function Body({ children, muted, small, tone, onPress }: { children: ReactNode; muted?: boolean; small?: boolean; tone?: 'warn' | 'ok'; onPress?: () => void }) {
  const th = useTheme();
  const color = tone ? th[tone] : muted ? th.muted : th.fg;
  return <Text onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={{ color, fontSize: small ? 13 : 16, lineHeight: small ? 18 : 23, textDecorationLine: onPress ? 'underline' : 'none' }}>{children}</Text>;
}

export function Card({ children, onPress, label }: { children: ReactNode; onPress?: () => void; label?: string }) {
  const th = useTheme();
  const style = { backgroundColor: th.card, borderColor: th.line, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 } as const;
  if (!onPress) return <View style={style}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}>{children}</Pressable>;
}

export function Button({ title, onPress, kind = 'primary', disabled, busy }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const th = useTheme();
  const bg = kind === 'primary' ? th.accent : kind === 'danger' ? th.warn : 'transparent';
  const fg = kind === 'secondary' ? th.accent : th.accentFg;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: bg, borderWidth: kind === 'secondary' ? 1.5 : 0, borderColor: th.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 })}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const th = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: th.muted, fontSize: 13 }}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={th.muted}
        style={{ minHeight: 48, borderWidth: 1, borderColor: th.line, borderRadius: 10, paddingHorizontal: 12, color: th.fg, backgroundColor: th.card, fontSize: 16, textAlign: 'auto' }} {...props} />
    </View>
  );
}

export function Chip({ title, selected, onPress }: { title: string; selected?: boolean; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: th.accent, backgroundColor: selected ? th.accent : 'transparent' }}>
      <Text style={{ color: selected ? th.accentFg : th.accent, fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}
export const Row = ({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) => <View style={{ flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap', gap: 8, alignItems: 'center' }}>{children}</View>;

export function Disclaimer({ kind = 'points' }: { kind?: 'points' | 'verification' | 'content' }) {
  const { t } = useLang();
  return <Body muted small>{t(`disclaimer.${kind}` as const)}</Body>;
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: th.accent, backgroundColor: value ? th.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {value ? <Text style={{ color: th.accentFg, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, color: th.fg, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Bar({ value, max }: { value: number; max: number }) {
  const th = useTheme();
  const pct = useMemo(() => (max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100))), [value, max]);
  return <View style={{ height: 8, borderRadius: 4, backgroundColor: th.line, overflow: 'hidden' }}><View style={{ width: `${pct}%`, height: 8, backgroundColor: th.accent }} /></View>;
}
export const styles = StyleSheet.create({});
