import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, refresh, sessionStore } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

/** Shown instead of the console until a staff member has enrolled an authenticator app (REQUIRE_ADMIN_MFA). */
export function MfaSetup() {
  const { t } = useI18n();
  const { completeMfaSetup, logout } = useAuth();
  const [secret, setSecret] = useState('');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ secret: string; otpauthUrl: string }>('/auth/totp/enroll', { method: 'POST' })
      .then((r) => {
        setSecret(r.secret);
        setUrl(r.otpauthUrl);
      })
      .catch((e) => setError(e instanceof ApiError ? e.body.message : t('state.error')));
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/totp/activate', { method: 'POST', body: { code } });
      // The old access token carries no MFA claim; refreshing mints one now that the second factor is proven.
      if (!(await refresh())) throw new Error('refresh');
      completeMfaSetup();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.message : t('state.error'));
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>{t('mfa.title')}</h1>
        <p>{t('mfa.intro')}</p>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {secret && (
          <div className="field">
            <label htmlFor="secret">{t('mfa.secret')}</label>
            <input
              id="secret"
              readOnly
              value={secret}
              style={{ width: '100%', fontFamily: 'monospace' }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <small style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>{url}</small>
          </div>
        )}
        <div className="field">
          <label htmlFor="code">{t('login.totp')}</label>
          <input
            id="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ width: '100%' }}
          />
        </div>
        <button
          className="btn primary"
          disabled={busy || code.length !== 6 || !secret}
          style={{ width: '100%' }}
        >
          {t('mfa.activate')}
        </button>
        <p style={{ textAlign: 'center' }}>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              sessionStore.set(null);
              void logout();
            }}
          >
            {t('nav.logout')}
          </button>
        </p>
      </form>
    </div>
  );
}
