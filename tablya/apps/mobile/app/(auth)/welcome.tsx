import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Row, toast, Txt } from '../../src/components/ui';
import { useI18n, useT } from '../../src/lib/i18n';
import { requestLocation } from '../../src/lib/location';
import { shell } from '../../src/lib/shell';
import { space, useColors } from '../../src/lib/theme';

export default function Welcome() {
  const { t, locale } = useT();
  const c = useColors();
  const [asked, setAsked] = useState(false);
  const switchLang = async () => {
    const { needsRestart } = await useI18n.getState().setLocale(locale === 'en' ? 'ar' : 'en');
    if (needsRestart) toast(t('profile.restart'));
  };
  const askLocation = async () => {
    try {
      await requestLocation();
    } catch {
      /* user can still browse without a location */
    }
    setAsked(true);
  };
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.bg, padding: space.xl, justifyContent: 'space-between' }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        {shell ? (
          <Button
            title={t('welcome.server')}
            variant="ghost"
            onPress={() => shell?.changeServer()}
          />
        ) : (
          <View />
        )}
        <Button
          title={locale === 'en' ? 'العربية' : 'English'}
          variant="ghost"
          onPress={switchLang}
          accessibilityHint={t('welcome.language')}
        />
      </Row>
      <View style={{ gap: space.lg, alignItems: 'center' }}>
        <Txt style={{ fontSize: 72 }}>🍲</Txt>
        <Txt variant="h1" style={{ textAlign: 'center' }} accessibilityRole="header">
          {t('welcome.title')}
        </Txt>
        <Txt muted style={{ textAlign: 'center' }}>
          {t('welcome.sub')}
        </Txt>
      </View>
      <View style={{ gap: space.md }}>
        {!asked && (
          <>
            <Txt variant="small" muted style={{ textAlign: 'center' }}>
              {t('welcome.locationWhy')}
            </Txt>
            <Row>
              <Button title={t('welcome.location')} onPress={askLocation} style={{ flex: 1 }} />
              <Button
                title={t('welcome.skipLocation')}
                variant="ghost"
                onPress={() => setAsked(true)}
              />
            </Row>
          </>
        )}
        {asked && (
          <>
            <Button title={t('welcome.cta')} onPress={() => router.push('/register')} />
            <Button
              title={t('welcome.cook')}
              variant="secondary"
              onPress={() => router.push({ pathname: '/register', params: { cook: '1' } })}
            />
            <Button
              title={t('welcome.haveAccount')}
              variant="ghost"
              onPress={() => router.push('/login')}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
