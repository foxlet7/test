import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function Login() {
  const { t, locale, setLocale } = useI18n();
  const { login, session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password, needTotp ? totp : undefined);
    } catch (err) {
      if ((err as { staffOnly?: boolean }).staffOnly) setError(t('login.staffOnly'));
      else if (err instanceof ApiError && err.body.code === 'MFA_REQUIRED') {
        // The server asks for a code (enrolled) or tells us enrolment is mandatory.
        if (/enable/i.test(err.body.message)) setError(t('login.setupMfa'));
        else {
          setNeedTotp(true);
          setError('');
        }
      } else if (err instanceof ApiError) setError(t(`errors.${err.body.code}`) !== `errors.${err.body.code}` ? t(`errors.${err.body.code}`) : err.body.message);
      else setError(t('state.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit} noValidate>
        <h1>{t('login.title')}</h1>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">{t('auth.email')}</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div className="field">
          <label htmlFor="pw">{t('auth.password')}</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%' }} />
        </div>
        {needTotp && (
          <div className="field">
            <label htmlFor="totp">{t('login.totp')}</label>
            <input id="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus style={{ width: '100%' }} aria-describedby="totp-hint" />
            <small id="totp-hint" style={{ color: 'var(--muted)' }}>{t('login.totpHint')}</small>
          </div>
        )}
        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>{t('auth.login')}</button>
        <p style={{ textAlign: 'center' }}><button type="button" className="btn sm" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}>{t('nav.language')}</button></p>
      </form>
    </div>
  );
}
