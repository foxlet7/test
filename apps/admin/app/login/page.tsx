'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login } from '@/lib/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="card" style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1>Staff sign in</h1>
      <p className="muted">Reviewers, content administrators and operations staff only.</p>
      <form onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await login(email, password); router.replace('/'); } catch (x: any) { setErr(x.code === 'not_staff' ? 'This account has no staff role.' : 'Sign-in failed.'); } }}>
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} /></label>
        <p className="err">{err}</p>
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
