'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/noc', 'NOC wall'], ['/devices', 'Devices'], ['/circuits', 'Circuits & cost'],
  ['/alerts', 'Alerts'], ['/probes', 'Probes'], ['/settings', 'Settings'],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={path === href || path.startsWith(href + '/') ? 'on' : ''}>{label}</Link>
      ))}
    </nav>
  );
}
