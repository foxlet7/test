'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

/** Public web page for account deletion requests (required by Google Play in addition to the in-app flow). */
export default function DeleteAccount() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  return (
    <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
      <h1>Delete your account</h1>
      <p>Deleting your account permanently erases your profile, activity records, notes, recordings, rankings entries and points. This cannot be undone.</p>
      <p className="muted">Sign in with your app email and password to confirm it is you. Copies in backups are removed within 30 days.</p>
      {state === 'done' ? <p className="ok">Your account has been deleted.</p> : (
        <form onSubmit={async (e) => { e.preventDefault(); try { await api('/public/deletion-request', { method: 'POST', json: { email, password } }); setState('done'); } catch { setState('error'); } }}>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} /></label>
          <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} /></label>
          {state === 'error' && <p className="err">We could not verify those details.</p>}
          <button className="danger" type="submit">Permanently delete my account</button>
        </form>
      )}
    </div>
  );
}
