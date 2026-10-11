import { useState } from 'react';
import type { Language, Tradition } from '@gdc/shared';
import { ApiError } from '../api';
import { Body, Card, Button, Chip, Disclaimer, Field, H1, Row, Screen, Toggle } from '../components/ui';
import { DEMO } from '../config';
import { errorKey, useLang } from '../i18n';
import { useSession } from '../session';

export default function Auth() {
  const { t, lang, setLang } = useLang();
  const { signIn } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [nick, setNick] = useState('');
  const [tradition, setTradition] = useState<Tradition | null>(null);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (mode === 'login') await signIn('/auth/login', { email: email.trim(), password });
      else await signIn('/auth/register', { email: email.trim(), password, inviteCode: invite.trim(), adultConfirmed: adult, pseudonym: nick.trim(), uiLanguage: lang, tradition });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'error';
      setErr(code === 'email_taken' || code === 'pseudonym_taken' || code === 'validation_failed' ? t('common.error') + ` (${code})` : t(errorKey(code)));
    }
    setBusy(false);
  };

  return (
    <Screen>
      <H1>{t('app.name')}</H1>
      <Body muted>{t('onboarding.body')}</Body>
      {DEMO && <Card><Body small tone="warn">{t('demo.banner')}</Body></Card>}
      <Row>
        {(['en', 'ar'] as Language[]).map((l) => <Chip key={l} title={l === 'en' ? 'English' : 'العربية'} selected={lang === l} onPress={() => setLang(l)} />)}
      </Row>
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      {mode === 'register' && (
        <>
          <Field label={t('auth.inviteCode')} value={invite} onChangeText={setInvite} autoCapitalize="characters" />
          <Field label={t('auth.pseudonym')} value={nick} onChangeText={setNick} autoCapitalize="none" />
          <Body muted small>{t('onboarding.traditionBody')}</Body>
          <Row>
            <Chip title={t('tradition.islam')} selected={tradition === 'islam'} onPress={() => setTradition('islam')} />
            <Chip title={t('tradition.christianity')} selected={tradition === 'christianity'} onPress={() => setTradition('christianity')} />
            <Chip title={t('tradition.none')} selected={tradition === null} onPress={() => setTradition(null)} />
          </Row>
          <Toggle label={t('auth.adultConfirm')} value={adult} onChange={setAdult} />
          <Disclaimer kind="points" />
        </>
      )}
      {err ? <Body tone="warn">{err}</Body> : null}
      <Button title={mode === 'login' ? t('auth.login') : t('auth.register')} onPress={submit} busy={busy} disabled={!email || !password || (mode === 'register' && (!adult || !invite || !nick))} />
      <Button kind="secondary" title={mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')} onPress={() => setMode(mode === 'login' ? 'register' : 'login')} />
    </Screen>
  );
}
