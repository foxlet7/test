import { useState } from 'react';
import { Button, Card, Field, Screen, Txt } from '../../src/components/ui';
import { api, ApiError } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { errorMessage } from '../../src/lib/errors';
import { useT } from '../../src/lib/i18n';

/** In-app account deletion (App Store guideline 5.1.1(v), Google Play account-deletion policy). */
export default function DeleteAccount() {
  const { t, locale } = useT();
  const clear = useAuth((s) => s.clear);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/account', { method: 'DELETE', body: { password } });
      clear();
    } catch (e) {
      setError(
        e instanceof ApiError && e.body.code === 'CONFLICT'
          ? t('auth.deleteBlocked')
          : errorMessage(e, locale),
      );
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Card>
        <Txt>{t('auth.deleteConfirm')}</Txt>
      </Card>
      <Txt muted>{t('auth.deleteBody')}</Txt>
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        error={error}
      />
      <Button
        title={t('auth.deleteAccount')}
        variant="danger"
        onPress={submit}
        loading={busy}
        disabled={password.length < 1}
      />
    </Screen>
  );
}
