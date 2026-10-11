import { router } from 'expo-router';
import { Linking, Switch } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Row, Screen, toast, Txt } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { isCook, useAuth } from '../../src/lib/auth';
import { useI18n, useT } from '../../src/lib/i18n';
import { shell } from '../../src/lib/shell';

const LEGAL = {
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
  terms: process.env.EXPO_PUBLIC_TERMS_URL ?? '',
  support: process.env.EXPO_PUBLIC_SUPPORT_URL ?? '',
};

export default function Profile() {
  const { t, locale } = useT();
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['prefs'],
    queryFn: () => api<{ push: boolean }>('/me/preferences'),
  });
  const setPush = useMutation({
    mutationFn: (push: boolean) => api('/me/preferences', { method: 'PUT', body: { push } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  });
  const lang = async () => {
    const next = locale === 'en' ? 'ar' : 'en';
    const { needsRestart } = await useI18n.getState().setLocale(next);
    void api('/me', { method: 'PATCH', body: { locale: next } }).catch(() => undefined);
    if (needsRestart) toast(t('profile.restart'));
  };
  const open = (url: string) => url && void Linking.openURL(url);
  return (
    <Screen>
      <Card>
        <Txt variant="h2">{user?.name}</Txt>
        <Txt muted>{user?.email}</Txt>
      </Card>
      {isCook(user) && (
        <Button title={t('profile.switchCook')} onPress={() => router.push('/cook')} />
      )}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt>{t('profile.notifications')}</Txt>
          <Switch
            accessibilityLabel={t('profile.notifications')}
            value={prefs.data?.push ?? true}
            onValueChange={(v) => setPush.mutate(v)}
          />
        </Row>
      </Card>
      <Button
        title={t('profile.addresses')}
        variant="secondary"
        onPress={() => router.push('/addresses')}
      />
      <Button
        title={`${t('profile.language')}: ${locale === 'en' ? 'العربية' : 'English'}`}
        variant="secondary"
        onPress={lang}
      />
      {!!LEGAL.support && (
        <Button
          title={t('profile.support')}
          variant="secondary"
          onPress={() => open(LEGAL.support)}
        />
      )}
      {!!LEGAL.privacy && (
        <Button title={t('profile.privacy')} variant="ghost" onPress={() => open(LEGAL.privacy)} />
      )}
      {!!LEGAL.terms && (
        <Button title={t('profile.terms')} variant="ghost" onPress={() => open(LEGAL.terms)} />
      )}
      {shell && (
        <Button
          title={t('welcome.server')}
          variant="secondary"
          onPress={() => shell?.changeServer()}
        />
      )}
      <Button title={t('auth.logout')} variant="secondary" onPress={() => void logout()} />
      <Button
        title={t('auth.deleteAccount')}
        variant="danger"
        onPress={() => router.push('/settings/delete-account')}
      />
    </Screen>
  );
}
