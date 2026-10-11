import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useNetwork } from '../lib/network';
import { radius, space, TOUCH, type as typo, useColors } from '../lib/theme';
import { useT } from '../lib/i18n';

// ───────── Text ─────────
export function Txt({
  variant = 'body',
  muted,
  color,
  style,
  children,
  ...rest
}: TextProps & {
  variant?: keyof typeof typo;
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}) {
  const c = useColors();
  return (
    <Text
      {...rest}
      style={[
        typo[variant],
        { color: color ?? (muted ? c.muted : c.text), textAlign: 'auto' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ───────── Screen ─────────
export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing,
  padded = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const c = useColors();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{
        padding: padded ? space.lg : 0,
        gap: space.lg,
        paddingBottom: space.xxl,
      }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.brand} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: padded ? space.lg : 0 }}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom', 'left', 'right']}>
      <OfflineBanner />
      {body}
      {footer}
    </SafeAreaView>
  );
}

// ───────── Button ─────────
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const bg = { primary: c.brand, secondary: c.surface, danger: c.danger, ghost: 'transparent' }[
    variant
  ];
  const fg = variant === 'primary' ? c.onBrand : variant === 'danger' ? '#fff' : c.text;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? c.border : bg,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{title}</Text>
      )}
    </Pressable>
  );
}

// ───────── Input ─────────
export function Field({
  label,
  error,
  hint,
  ...props
}: TextInputProps & { label: string; error?: string; hint?: string }) {
  const c = useColors();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label">{label}</Txt>
      <TextInput
        {...props}
        accessibilityLabel={label}
        accessibilityHint={hint}
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor={c.muted}
        style={[
          styles.input,
          {
            backgroundColor: c.surface,
            color: c.text,
            borderColor: error ? c.danger : focus ? c.brand : c.border,
          },
          props.multiline && { minHeight: 88, textAlignVertical: 'top' },
        ]}
      />
      {error ? (
        <Txt variant="small" color={c.danger} accessibilityRole="text">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" muted>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ───────── Card / Pill / Row ─────────
export function Card({
  children,
  style,
  onPress,
  label,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  label?: string;
}) {
  const c = useColors();
  const inner = [styles.card, { backgroundColor: c.surface, borderColor: c.border }, style];
  if (!onPress) return <View style={inner}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [inner, pressed && { opacity: 0.9 }]}
    >
      {children}
    </Pressable>
  );
}

export function Pill({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'ok' | 'warn' | 'bad' | 'neutral';
}) {
  const c = useColors();
  const col = tone === 'ok' ? c.ok : tone === 'warn' ? c.warn : tone === 'bad' ? c.danger : c.muted;
  return (
    <View
      style={{
        borderColor: col,
        borderWidth: 1,
        borderRadius: radius.pill,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: col, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Row({
  children,
  style,
  gap = space.md,
  ...rest
}: ViewProps & { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>
      {children}
    </View>
  );
}

// ───────── Loading / empty / error ─────────
export function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const o = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        { height, width, borderRadius: radius.sm, backgroundColor: c.border, opacity: o },
        style,
      ]}
    />
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View style={{ gap: space.lg }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ gap: space.sm }}>
          <Skeleton height={120} />
          <Skeleton height={16} width="60%" />
          <Skeleton height={12} width="40%" />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.center} accessibilityRole="text">
      <Txt style={{ fontSize: 44 }}>🍽️</Txt>
      <Txt variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, locale } = useT();
  const offline = error instanceof ApiError && error.isNetwork;
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Txt style={{ fontSize: 44 }}>{offline ? '📡' : '⚠️'}</Txt>
      <Txt variant="body" style={{ textAlign: 'center' }}>
        {errorMessage(error, locale)}
      </Txt>
      {onRetry && <Button title={t('common.tryAgain')} onPress={onRetry} variant="secondary" />}
    </View>
  );
}

/** Standard async contract for every data screen: loading → error(+retry) → empty → content. */
export function AsyncView<T>({
  query,
  empty,
  skeleton,
  children,
}: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (d: T) => boolean;
  skeleton?: ReactNode;
  children: (d: T) => ReactNode;
}) {
  const { t } = useT();
  if (query.isLoading) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.error && !query.data)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  if (empty?.(query.data)) return <EmptyState title={t('common.empty')} />;
  return <>{children(query.data)}</>;
}

export function OfflineBanner() {
  const offline = useNetwork((s) => s.offline);
  const { t } = useT();
  const c = useColors();
  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: c.warn, padding: space.sm }}
    >
      <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>
        {t('common.offlineBanner')}
      </Text>
    </View>
  );
}

// ───────── Toast ─────────
const useToasts = create<{
  msg: string | null;
  kind: 'ok' | 'bad';
  show(m: string, k?: 'ok' | 'bad'): void;
  hide(): void;
}>((set) => ({
  msg: null,
  kind: 'ok',
  show: (msg, kind = 'ok') => set({ msg, kind }),
  hide: () => set({ msg: null }),
}));
export const toast = (m: string, k: 'ok' | 'bad' = 'ok') => useToasts.getState().show(m, k);

export function ToastHost() {
  const { msg, kind, hide } = useToasts();
  const c = useColors();
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(hide, 3500);
    return () => clearTimeout(id);
  }, [msg, hide]);
  if (!msg) return null;
  return (
    <View
      pointerEvents="none"
      style={styles.toastWrap}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View
        style={{
          backgroundColor: kind === 'bad' ? c.danger : c.text,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          maxWidth: 440,
        }}
      >
        <Text style={{ color: kind === 'bad' ? '#fff' : c.bg, fontWeight: '600' }}>{msg}</Text>
      </View>
    </View>
  );
}

// ───────── Confirm dialog (destructive actions) ─────────
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
  confirmDisabled,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const c = useColors();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: c.surface }]} accessibilityRole="alert">
          <Txt variant="h3">{title}</Txt>
          {body ? <Txt muted>{body}</Txt> : null}
          {children}
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button title={t('common.cancel')} variant="ghost" onPress={onCancel} disabled={busy} />
            <Button
              title={confirmLabel}
              variant={danger ? 'danger' : 'primary'}
              loading={busy}
              disabled={confirmDisabled}
              onPress={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: TOUCH + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: TOUCH + 4,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialog: {
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  toastWrap: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
});
