import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { ActionForm } from '@/components/ActionForm';
import { loginAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function Login() {
  if ((await db.user.count()) === 0) redirect('/setup');
  return (
    <div className="auth">
      <div className="card">
        <div className="card-head"><h2>noc<span style={{ fontWeight: 300 }}>platform</span></h2></div>
        <div className="card-body">
          <ActionForm action={loginAction} submit="Log in" resetOnOk={false}>
            <label>Email<input name="email" type="email" required autoComplete="username" autoFocus /></label>
            <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
