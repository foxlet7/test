import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Nav } from '@/components/Nav';
import { logoutAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const tenant = await db.tenant.findUnique({ where: { id: u.tenantId }, select: { name: true } });
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">noc<b>platform</b></div>
        <Nav />
        <div className="who">
          <span className="hide-sm">{tenant?.name} · {u.name} ({u.role.toLowerCase()})</span>
          <form action={logoutAction}><button className="btn ghost small" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }}>Log out</button></form>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
