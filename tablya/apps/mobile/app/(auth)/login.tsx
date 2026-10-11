import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Field, Screen, Txt } from '../../src/components/ui';
import { errorMessage } from '../../src/lib/errors';
import { useAuth } from '../../src/lib/auth';
import { useT } from '../../src/lib/i18n';

export default function Login() {
  const { t, locale } = useT();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError(t('errors.VALIDATION_FAILED'));
    setBusy(true);
    setError('');
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e) {
      setError(errorMessage(e, locale));
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Txt variant="h1" accessibilityRole="header">
        {t('auth.login')}
      </Txt>
      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
      />
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
        error={error}
      />
      <Button title={t('auth.login')} onPress={submit} loading={busy} />
      <Button
        title={t('auth.noAccount')}
        variant="ghost"
        onPress={() => router.replace('/register')}
      />
    </Screen>
  );
}
