import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { ActionForm } from '@/components/ActionForm';
import { setupAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function Setup() {
  if ((await db.user.count()) > 0) redirect('/login');
  return (
    <div className="auth">
      <div className="card">
        <div className="card-head"><h2>Set up your NOC</h2></div>
        <div className="card-body">
          <p className="sub" style={{ marginTop: 0 }}>Create your organisation and the first administrator account.</p>
          <ActionForm action={setupAction} submit="Create and continue" resetOnOk={false}>
            <label>Organisation<input name="org" required maxLength={120} placeholder="AlasilaCX" /></label>
            <div className="row2">
              <label>Your name<input name="name" required maxLength={120} /></label>
              <label>Currency<input name="currency" defaultValue="SAR" maxLength={3} required /></label>
            </div>
            <label>Email<input name="email" type="email" required autoComplete="username" /></label>
            <label>Password <span className="hint">at least 10 characters</span><input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
