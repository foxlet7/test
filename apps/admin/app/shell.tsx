'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSession, logout } from '@/lib/api';

const NAV: { href: string; label: string; roles: string[] }[] = [
  { href: '/', label: 'Pilot', roles: ['*'] },
  { href: '/content', label: 'Content', roles: ['content_admin', 'islamic_reviewer', 'christian_reviewer', 'translation_reviewer'] },
  { href: '/scripture', label: 'Scripture tasks', roles: ['content_admin', 'islamic_reviewer', 'christian_reviewer'] },
  { href: '/review', label: 'Verification queue', roles: ['verification_reviewer'] },
  { href: '/moderation', label: 'Moderation', roles: ['moderator', 'auditor', 'translation_reviewer', 'content_admin'] },
  { href: '/rules', label: 'Scoring rules', roles: ['content_admin'] },
  { href: '/ops', label: 'Operations', roles: ['super_admin', 'auditor'] },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [roles, setRoles] = useState<string[] | null>(null);
  const isPublic = path === '/login' || path === '/delete-account';

  useEffect(() => {
    const s = getSession();
    setRoles(s?.roles ?? null);
    if (!s && !isPublic) router.replace('/login');
  }, [path, isPublic, router]);

  if (isPublic) return <main>{children}</main>;
  if (!roles) return <main><p className="muted">Loading…</p></main>;
  const can = (r: string[]) => r.includes('*') || roles.includes('super_admin') || r.some((x) => roles.includes(x));
  return (
    <>
      <header className="top">
        <strong>Good Deeds Admin</strong>
        <nav>{NAV.filter((n) => can(n.roles)).map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}</nav>
        <span className="muted">{roles.join(', ')}</span>
        <button className="secondary" onClick={async () => { await logout(); router.replace('/login'); }}>Sign out</button>
      </header>
      <main>{children}</main>
    </>
  );
}
